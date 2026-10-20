# Архитектура ФШ777 · 0.8

Независимый TypeScript/React-редактор с Canvas 2D и отдельной Electron-оболочкой. Сервер обработки изображений не нужен. Adobe-код не используется; ag-psd — MIT-кодек формата, не готовый движок Photoshop.

## Модули и границы

| Область                    | Файлы                                                                                                               | Ответственность                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Модель                     | `types.ts`, `engine/document.ts`                                                                                    | Immutable document/layers, валидация импортированных данных, геометрия, эффективная блокировка с учётом предков                  |
| Команды / история          | `engine/history.ts`, `hooks/useEditor.ts`                                                                           | `DocumentCommand.execute/undo`, `ReplaceDocumentCommand`, commit жеста один раз, redo/travel, снимки и бюджеты                   |
| Рабочая среда              | `hooks/useWorkspace.ts`, `HomeScreen.tsx`                                                                           | До 6 сессий, независимая история, стабильные вкладки, главная, восстановление, безопасное закрытие, применение smart-content     |
| Дерево слоёв               | `engine/layerOperations.ts`, `smartObjects.ts`                                                                      | Целые поддеревья, parentId, предотвращение циклов, группировка/дублирование/удаление, вложенные документы                        |
| Инструменты                | `components/ToolRail.tsx`, `engine/brush.ts`, `selection.ts`, `pixels.ts`, `CanvasStage.tsx`                        | Pointer gestures, подтипы, магнитная привязка лассо, маски выделения, кисть/штамп/заливка; preview и единичный commit            |
| Отрисовка                  | `engine/render.ts`, `scene.ts`, `warpRenderer.ts`, `projectiveTexture.ts`, `projection.ts`, `styles.ts`             | RAF coalescing, cache нижнего неизменённого prefix, scene/group compositing, стили, маски, перспектива, экспорт                  |
| Тяжёлые операции           | `engine/pixel.worker.ts`, `psd.worker.ts`, `processing.ts`, codec dispatcher в `psd.ts`                             | Обработка пикселей и PSD-кодирование вне UI-потока, transferable buffers, ошибки/лимиты                                          |
| Файлы                      | `engine/fileManager.ts`, `psd.ts`, `psdBinary.ts`, `psdMetadata.ts`, `psdIntegrity.ts`                              | Выбор представления PSD, native layers/masks/smart objects, сохранение исходных секций, supplemental XMP                         |
| Исходники / восстановление | `engine/psdSource.ts`, `storage.ts`                                                                                 | Ограниченный source LRU, оригинальные bytes/composite/baseline, IndexedDB projects/sources/fonts, порядок асинхронных сохранений |
| Шрифты                     | `engine/fonts.ts`, `fontCatalog.json`, `fontNames.json`, `FontsDialog.tsx`                                          | SFNT name parser, FontFace, bounded upload/cache, native PostScript names, Google Fonts/OFL                                      |
| Интерфейс                  | `components/`, `styles.css`, `App.tsx`                                                                              | Панели/меню/диалоги и оркестрация, не PSD-парсер. Текстовые настройки справа                                                     |
| Восстановление J           | `engine/repair.ts`, `repair.worker.ts`, `repairJob.ts`, `repairPreview.ts`, `repairPlacement.ts`                    | Paper-plane/exemplar, ROI/target/work limits, abort/timeout, cached preview and donor overlay, explicit source/stack placement   |
| Рамочный текст             | `engine/textLayout.ts`, `textEntries.ts`, `textEntriesFormat.ts`, `TextFrameSettings.tsx`, `TextEntriesPanel.tsx`   | Bounded Unicode layout, font fitting, rectangles/ellipse, validated local script and atomic linking                              |
| Запись операций            | `editorEvents.ts`, `actionRecorder.ts`, `actionSchema.ts`, `actionStorage.ts`, `actions.ts`, `useActionRecorder.ts` | Final commits → validated commands; explicit blockers; immutable transactional replay, bounded recovery                          |
| Док-панели                 | `engine/panelLayout.ts`, `PanelDock.tsx`, `ActionsPanel.tsx`                                                        | Validated persistent layout, RAF gesture preview, commit/cancel, viewport clamp, mounted tabs                                    |
| Настольная граница         | `desktop/main.cjs`, `preload.cjs`, `protocol.cjs`, `fonts.cjs`, `files.cjs`                                         | Custom app protocol, доверенный main frame, whitelist IPC, native save dialog, atomic write, фиксированный Windows font query    |

Точные имена renderer-подмодулей смотри в `src/engine/`: декомпозиция сохраняет общие cache/geometry helpers. `App`/`CanvasStage` всё ещё крупные координаторы; дальнейшее выделение каждого gesture handler возможно без изменения файлового формата.

## Поток изменения

```text
Pointer / клавиша / контрол
  → проверка инструмента, выделения, замка и бюджета
  → временный immutable document / bitmap override
  → FrameScheduler: один последний кадр
  → SceneRenderer + cached layers/groups
  → pointerup/blur: ReplaceDocumentCommand(before, after, label)
  → useEditor: undo/redo + selection snapshot
  → автокопия committed document в IndexedDB
```

Команды не клонируют все пиксели каждый раз: неизменённые строки источников/слои разделяются снимками. Расчёт истории учитывает уникальные source/mask строки, ArrayBuffer raster-выделений и smart-content. Минимальный текущий/предыдущий снимок может быть больше целевого бюджета; это явно указано в настройках. При общем превышении сокращается undo неактивных вкладок, а не их текущие документы.

Кэшируется только неизменённый нижний prefix. Стек с группами/обтравкой или исходный PSD-композит проходит полный scene path, чтобы cache не менял порядок смешивания. Групповые поверхности создаются по необходимости и в масштабе view; текущие intermediate surfaces ограничены отдельно. Это уменьшает лишнюю работу, но не превращает Canvas 2D в полный GPU/Adobe engine.

## Сохранение PSD

1. Нет изменений + тот же контейнер PSD/PSB + исходные байты доступны → byte-for-byte оригинал.
2. Внешний вид не изменился → native metadata update, сохранение совместимой исходной merged-секции и неизвестных image resources. Layout/color-mode checks не позволяют копировать incompatible PSD/PSB RLE/gray sections.
3. Визуальные изменения → пересборка native layer tree, mask/placement/FX metadata в доступном объёме и реальный merged raster текущего документа.
4. Дополнительный XMP содержит собственный документ, а **не заменяет** пункты 1–3. SHA-256 считается по финальному файлу с обнулённым integrity-slot. Внешнее изменение → чтение настоящих native-слоёв; это контроль актуальности, не аутентификация.
5. Worker возвращает bounded `ArrayBuffer`. Веб скачивает Blob; Electron показывает диалог и пишет через ограниченный IPC.

Для transformed native mask покрытие выводится из той же отрисованной alpha, что используется в редакторе. Исходные скрытые пиксели не удаляются. Density/feather для такого native mask запекаются; управляющие параметры остаются в XMP. При выключенной маске native source color/alpha не подменяются изображением с включённой маской.

Нативные смарт-объекты содержат embedded linked PSD. Применение smart-tab сначала полностью строит новый preview, затем делает одно родительское действие истории; ошибка оставляет родителя нетронутым. Замок предка учитывается. Родитель нельзя закрыть, пока открыты его smart-content вкладки.

## Восстановление и конкуренция

`reserveSaveStamp()` вызывается **до** асинхронной миниатюры. IndexedDB readwrite transaction сравнивает stamp с последней версией: поздний старый результат не заменяет новый recent/current. `current` и `recent:id` различаются; фоновая запись не обязана менять активный recovery pointer. Pending writes учитываются в beforeunload.

Source cleanup использует ссылки всех сохранённых документов, включая вложенный smart-content, и суточный grace period для ещё не подтверждённого импорта. Курсор не загружает все оригинальные PSD одновременно. Отказ persistence отображается отдельно от успешной записи PSD на диск.

## Desktop security boundary

- Sandbox + context isolation; renderer не имеет Node.js/filesystem/shell API.
- Путь файла никогда не принимается от renderer. Renderer передаёт document ID, suggested filename, allowed extension и bounded bytes.
- Только выбранный пользователем путь запоминается для Ctrl+S; Save As снова спрашивает. Временный файл создаётся рядом, запись синхронизируется, затем rename заменяет целевой файл. Cancel/ошибка не выдаются за успех.
- Font/save IPC принимает только доверенный top-level frame своего окна. Windows font query фиксирован, не является выполнением команды пользователя.
- Навигация/новые окна запрещены; CSP не разрешает remote scripts. Каталог шрифтов использует только GitHub API; TTF/OTF разбирается браузерным FontFace в sandbox.

Это защитные меры, не математическая гарантия отсутствия уязвимостей.

## Воспроизвести проверки

```bash
npm ci
npm run format:check
npm run check
npm test
npm run test:desktop-security
npm run test:e2e
python -m venv .venv
.venv/bin/pip install -r tests/interop/requirements.txt
.venv/bin/python tests/interop/check_psd.py
npm audit --audit-level=moderate
```

Windows: Python находится в `.venv\\Scripts\\python.exe`; native smoke — `npm run test:desktop`. После `npm run desktop:windows` можно задать `FSH777_SMOKE_EXECUTABLE` путём к `release/win-unpacked/ФШ 777.exe` и повторить smoke. GitHub Actions делает оба запуска автоматически перед release draft.

Браузерные тесты используют **production bundle**, не vite dev. Fixture pixels проверяются отдельно от UI; крупные массивы сравниваются без огромного assert diff. Python psd-tools — независимый reader/compositor. Допуск 2/255 относится только к перечисленным масочным fixtures и учебному редакторскому процессу; он не доказывает полную Adobe/XnConvert совместимость.

Необходимые дальнейшие направления: реальные проблемные пользовательские PSD, color-managed ICC/16-bit core, больше native adjustment/vector/FX semantics, rich/vertical type и variable axes, аппаратные perf-бенчмарки. Ограничения текущего выпуска — в `COMPATIBILITY.md`.

## Макет: изоляция задач и воспроизведение

J передаёт worker копии пикселей/масок: исходные preview-буферы не detach. Смена параметров/источника, закрытие и отмена завершают предыдущий worker; поздние ответы игнорируются. Есть вычислительный бюджет алгоритма и внешний 60-секундный тайм-аут. Результат — отдельный растровый слой, не модификация источника. Вариант под верхним текстом использует один и тот же индекс для исключения текста из исходного композита и вставки результата; группы и обтравочные цепочки не разрезаются. Текст, обтравленный к нетекстовой основе ниже стека, остаётся в исходном композите; вставка не создаёт для него новую clipping base.

Предпросмотр держит original/after/overlay canvas. Ползунок меняет compositing clip, не пересобирает RGBA. Кисть интерполирует отрезки, recolor охватывает dirty rectangle, а не всю ROI. E2E считает `putImageData`: перемещение разделителя не пишет RGBA, штрих изменяет лишь ограниченную область. Это проверка объёма работы, не бенчмарк GPU/FPS.

Текстовая подготовка ждёт конкретные FontFace descriptors и ограниченный sample перед layout/export; cold-font E2E задерживает выдачу встроенного Oswald и проверяет первую отрисовку/PSD. Layout ограничен 20 000 символами, 512 строками, 24 000 измерениями, 128 cached entries. Эллипс экспортируется как hard-wrapped native box text с отступами строк, не Adobe path text; точная модель рамки остаётся в XMP.

Рекордер слушает `EditorEvent` после final commit, не каждое движение/клавишу. JSON — только проверяемые данные. Неизвестный включённый шаг блокирует запуск; частичное выполнение не коммитится. Последний 200-й допустимый шаг сохраняется; переполнение в середине составного события создаёт blocker. Draft удаляется лишь после успешного сохранения библиотеки, содержащей ту же запись. При 100 операциях он остаётся отдельно, восстанавливается после удаления ненужной операции. Ошибка квоты не удаляет единственную копию. Перезапуск никогда не запускает запись автоматически.

Док не меняет документ/историю: обработанные локальные клавиши не проходят в глобальные nudges, Escape отменяет resize, tabs не размонтируют редактор сценария. Плавающий док остаётся внутри одного окна приложения.

## Нативная геометрия и проекция 0.5

- `textGeometry.ts` измеряет реальные Canvas ink metrics; `layerGeometry.ts` объединяет selection/world/raster bounds. Point и paragraph frame различаются. `font-synthesis` задан одинаково для видимого и detached canvas. Загрузка шрифтов инвалидирует кеши, не меняет документ и историю.
- `shapeGeometry.ts` задаёт общие кривые Безье/радиусы/экстремумы/проекцию; `shapeRenderer.ts` рисует те же контуры. `psdVector.ts` пишет реальные fill/path/stroke/origination, `psdText.ts` — point/box type и guarded import. Неоднородные стили/вертикальный текст и неизвестные vector paints не объявляются поддержанными.
- `projectiveTexture.ts`: perspective-correct WebGL texture sampling, premultiplied RGBA, без смешивания повторных треугольников. Один GL-контекст, обычный Canvas2D-кеш результата. Недоступность/потеря контекста → CPU inverse homography с билинейной premultiplied-интерполяцией. Это отдельные браузерные тесты, а не обещание FPS на любой машине.
- `warpRenderer.ts` привязывает результат к документным пикселям, включая вращение. Целочисленный сдвиг может переиспользовать кеш; дробный сдвиг/поворот изменяет фазу сэмплирования и пересчитывается. `rasterizedGeometry` переносит реальные границы/warp/маску/стили при растеризации и создании smart-содержимого.
- `psdSmart.ts` проверяет размещение, reflection, регулярный identity-envelope и одиночный Gaussian Blur 0–30 px. Неизвестные эффекты/внешние маски/comp/animation/warp не пропускаются молча. Автораскрытие embedded PSD ограничено 3 уровнями, 8 файлами, 32 МиБ embedded bytes / 32 Мп холстов; исходные bytes сохраняются и для остальных случаев.
- Размытый/проективный текст и деформированные stroke/FX экспортируются через вложенные **редактируемые** PSD. Локальные FX с исходной маской остаются на правильном уровне. Native smart previews после визуальных правок обновляются отдельно от сохранённых placement/linked-структур. No-edit original остаётся побайтным.
- `psdReport.ts` / `PsdReportDialog.tsx` показывают реальные верхние/групповые native-структуры, число editable conversions, шрифты и замечания; это не recursive Adobe compatibility certification. Независимый reader проверяет 35 случаев; TypeLayer/smart-кеши компонуются, шрифты и smart filters не регенерируются Adobe-движком.

## Неразрушающие коррекции, выделения и компоновка 0.6

- `adjustmentTypes/Math/Renderer/Layers.ts`, `psdAdjustments.ts`: bounded data-only модель 15 видов; LUT, natural cubic, linear-light exposure TRC≈2.2, premultiplied-aware stack compositing без изменения alpha. Коррекция применяется непосредственно к уже нарисованному backdrop внутри текущего group/clip scope. `CorrectionProperties`, `CurveEditor`, `Histogram` дают реальные параметры; histogram — alpha-weighted preview до 384 px, не полноразмерный научный анализ.
- `selectionPixels.ts`: fuzzy-set max/min/subtract, точный separable squared Euclidean distance transform, box-based Gaussian feather, sliding box smoothing, connected/global color selection. `selection.worker`/`selectionJob` копируют до transfer и завершают worker при cancel/timeout. `selectionOutline` ограничивает только display geometry, не исходные coverage bytes.
- `HistoryEntry.pixelSelection` и `EditorSession.pixelSelection` находятся вне сериализуемого документа. `useEditor` коммитит выбор/quick-mask как history snapshots, возвращает их при undo/redo/tab restore; bytes участвуют в существующих memory budgets. Изменение выделения публикуется отдельным событием рекордера и пока является blocker, не молчаливо исполняемым действием.
- `layout.ts`, `GuidesDialog`, `arrange.ts`: непечатные guides/grid, native resource 1032, snapping в экранных px и атомарная компоновка поддеревьев. `CanvasStage.visualDoc` зависит от artwork-ссылок, а не от непечатной разметки; drag направляющей не перерисовывает pixel-canvas.
- `sameEmbeddedContent` отличается от `sameVisual`: имена/направляющие/прочая семантика вложенного документа требуют обновления linked PSD даже при неизменном preview. Исходные raw/linked данные не должны затенять metadata-only правки.
- `rasterFilters`/`filter.worker`/`filterJob`/`filterLayers`: отменяемый CPU pipeline до 8 Мп, weighted-alpha filtering, детерминированный seed. Пиксели обрабатываются в разрешении источника; геометрия/FX/маски/живые коррекции не запекаются в чужую сетку сэмплирования. `RasterFilterDialog` привязывает результат к ключу параметров, не позволяет применить старый preview, делает новую явную bitmap-копию и по умолчанию скрывает оригинал.
- `maskOperations`: меняются mask pixels/defaultColor, не layer kind. `commandSearch` и `CommandPalette` используют те же обработчики, что меню/инструменты, имеют aliases/раскладку/recents, не исполняют строки как код.
- Persistent source keys immutable: одинаковый PNG не заменяет уже используемый HTMLImage/Canvas другим представлением с чуть отличающейся фильтрацией Chromium. `mask-preview:` — явное исключение для живой кисти. Исправление проверяется на повороте/отражении/blur/маске без расширения допуска.

Тестовая матрица 0.8: 284 unit в 32 файлах, 122 production browser, 35 independent PSD fixtures, 12 desktop security/IPC/font-probe/batch. Native Windows smoke дополнен command search, levels/curves+mask, Quick Mask, native guide resource, Wand worker, filter worker/сохранением original smart/undo. Эти проверки не равны интерактивному NSIS-install тесту, Adobe execution или полной сертификации формата.

Синтетический CPU-benchmark: `node --expose-gc scripts/benchmark-filters.mjs 4096 2048`. Отдельный процесс Node, без PNG encode/UI/Windows; результат не используется для сравнений скорости с Photoshop.

## Контуры, карты цвета и ввод 0.7

- `pathEditing.ts`: чистая геометрия узлов/усиков, exact De Casteljau, bounded nearest-segment, точные cubic bounds и смена локальной системы с сохранением маски. `usePathTool.ts` отделяет черновик/выбор/жест от документа; `PathOverlay` не изменяет пиксели, `PathProperties` управляет данными. `pathSelection.ts` строит coverage без декоративного stroke/FX. Поддержанные изменения проходят через обычные history/PSD/action операции.
- `gradientRamp.ts`, `colorLut.ts`, `lutExport.ts`: ограниченные данные, RGB-interpolation, строгий CUBE parser, только применимый верхний color stack. `GradientEditor`, `ColorLookupProperties`, `ExportLutDialog` не подменяют данные превью-картинкой. Математика и LUT/модель вынесены в отдельный `color-engine` chunk без React/DOM dependency cycle.
- `psdAdjustments.ts` переводит Photo/GradientMap/ColorLookup в настоящие descriptors. `prepareAdjustmentRecords` исправляет integer-percent truncation перед каждым worker write. Classic grdm/v1 избегает сломанной SDK-v3 сигнатуры. `withoutXmpResource` удаляет только resource 1060, не прогоняя native поля через повторный кодек в interop-тесте.
- `numericExpression.ts` — recursive-descent арифметика с жёсткими пределами, не eval. `Field` хранит черновик отдельно, сохраняет ARIA spinbutton/стрелки, не округляет модель на простом фокусе. `sameProjectData` применяется только при завершении жеста; общие immutable поддеревья пропускаются по ссылке, настоящие metadata-only изменения не игнорируются.
- `desktop/fontProbe.cjs` — read-only fallback имен из ограниченных SFNT/OTF/TTC tables при отказе фиксированного Windows query; native IPC origin/frame checks не ослаблены. `.cube` добавлен в явный whitelist атомарного file writer с текстовым/размерным guard.

## Рабочее пространство и миграция 0.7.1

- `textEntries.ts` / `textEntriesFormat.ts` / `TextEntriesPanel.tsx` — обычные текстовые блоки с необязательными дополнительными полями. Reader явно отделяет актуальные данные от старого формата; обмен очищает внешние ID/links. `document.ts`, `history.ts` и `psdSource.ts` учитывают новые метаданные, их бюджет и невизуальную природу.
- `panelLayout.ts` мигрирует сохранённые имена сред/вкладок, не сбрасывая пользовательские размеры и положение. Основной интерфейс не содержит фабрики отдельной учебной страницы.
- `bundledAssets.ts` — фиксированная таблица разрешённых локальных ресурсов. Legacy bytes в `public/compat/` запрашиваются только для соответствующих сохранённых документов; новые документы и главная их не используют.
- `tests/fixtures/editor/text-blocks.cjs` строит синтетические PNG/текстовые данные без зависимости от приложения или иллюстраций. Browser/desktop/benchmark используют один контракт, не скрытый production-test endpoint.
- `textPreview.ts` восстанавливает истинную однотонную заливку eligible TypeLayer cache после Canvas premultiplication quantization. Перед нормализацией проверяется весь кеш; неизвестные/цветные варианты остаются исходными. Native тип слоя и metadata не меняются.

## Стили, градиенты, библиотеки и пакет 0.8

- `styles.ts` — единственный шлюз нормализации (`normalizeStyles`) и рендера стилей. Каноническая модель — упорядоченные массивы экземпляров; легаси-одиночки 0.7 мигрируют внутри нормализатора, поэтому `document.ts`, операции и PSD получают одну форму данных. Отрисовка идёт группами «тени → внешнее свечение → содержимое с наложениями (Fill) → внутренние эффекты → обводки», внутри списка индекс 0 верхний.
- `gradientRamp.ts` расширен до полного определения градиента: color/opacity stops, midpoint-искажение по семантике дескриптора, детерминированный `mulberry32` шум в RGB/HSB/Lab и семплирование в Canvas/CSS из одних функций. `GradientEditor` (карта градиента) и `GradientDefinitionEditor` (инструмент и наложения) редактируют одни данные, а не превью.
- `libraries.ts` — локальные библиотеки градиентов/стилей, буфер стиля и строгий JSON-обмен с лимитами; документы библиотек не содержат. `batch.ts` — последовательный пакетный конвейер поверх обычных импорта, `runAction` и экспорта, без отдельной «пакетной» семантики операций.
- Десктопный вывод пакета: основной процесс хранит выбранную пользователем папку по непрозрачному UUID (`chooseBatchFolder`/`saveBatchFile`); renderer не получает и не передаёт путей, имя файла проходит тот же `validateSaveRequest`, запись атомарна и не перезаписывает существующие файлы.
- Знак ULTRA задан одним SVG (`components/Brand.tsx` ≡ `public/favicon.svg`); `scripts/generate-icons.mjs` воспроизводимо строит из него `desktop/icon.png` и PNG-сжатый `icon.ico`.
