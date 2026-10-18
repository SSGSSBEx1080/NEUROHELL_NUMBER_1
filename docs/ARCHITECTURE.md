# Архитектура ФШ777 · 0.4

Независимый TypeScript/React-редактор с Canvas 2D и отдельной Electron-оболочкой. Сервер обработки изображений не нужен. Adobe-код не используется; ag-psd — MIT-кодек формата, не готовый движок Photoshop.

## Модули и границы

| Область                    | Файлы                                                                                                               | Ответственность                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Модель                     | `types.ts`, `engine/document.ts`                                                                                    | Immutable document/layers, валидация импортированных данных, геометрия, эффективная блокировка с учётом предков                  |
| Команды / история          | `engine/history.ts`, `hooks/useEditor.ts`                                                                           | `DocumentCommand.execute/undo`, `ReplaceDocumentCommand`, commit жеста один раз, redo/travel, снимки и бюджеты                   |
| Рабочая среда              | `hooks/useWorkspace.ts`, `HomeScreen.tsx`                                                                           | До 6 сессий, независимая история, стабильные вкладки, главная, восстановление, безопасное закрытие, применение smart-content     |
| Дерево слоёв               | `engine/layerOperations.ts`, `smartObjects.ts`                                                                      | Целые поддеревья, parentId, предотвращение циклов, группировка/дублирование/удаление, вложенные документы                        |
| Инструменты                | `components/ToolRail.tsx`, `engine/brush.ts`, `selection.ts`, `pixels.ts`, `CanvasStage.tsx`                        | Pointer gestures, подтипы, магнитная привязка лассо, маски выделения, кисть/штамп/заливка; preview и единичный commit            |
| Отрисовка                  | `engine/render.ts`, `scene.ts`, `warpRenderer.ts`, `projection.ts`, `styles.ts`                                     | RAF coalescing, cache нижнего неизменённого prefix, scene/group compositing, стили, маски, перспектива, экспорт                  |
| Тяжёлые операции           | `engine/pixel.worker.ts`, `psd.worker.ts`, `processing.ts`, codec dispatcher в `psd.ts`                             | Обработка пикселей и PSD-кодирование вне UI-потока, transferable buffers, ошибки/лимиты                                          |
| Файлы                      | `engine/fileManager.ts`, `psd.ts`, `psdBinary.ts`, `psdMetadata.ts`                                                 | Выбор представления PSD, native layers/masks/smart objects, сохранение исходных секций, supplemental XMP                         |
| Исходники / восстановление | `engine/psdSource.ts`, `storage.ts`                                                                                 | Ограниченный source LRU, оригинальные bytes/composite/baseline, IndexedDB projects/sources/fonts, порядок асинхронных сохранений |
| Шрифты                     | `engine/fonts.ts`, `fontCatalog.json`, `fontNames.json`, `FontsDialog.tsx`                                          | SFNT name parser, FontFace, bounded upload/cache, native PostScript names, Google Fonts/OFL                                      |
| Интерфейс                  | `components/`, `styles.css`, `App.tsx`                                                                              | Панели/меню/диалоги и оркестрация, не PSD-парсер. Текстовые настройки справа                                                     |
| J-клининг                  | `engine/repair.ts`, `repair.worker.ts`, `repairJob.ts`, `repairPreview.ts`, `repairPlacement.ts`                    | Paper-plane/exemplar, ROI/target/work limits, abort/timeout, cached preview and donor overlay, explicit source/stack placement   |
| Манга-текст                | `engine/textLayout.ts`, `script.ts`, `scriptFormat.ts`, `TextFrameSettings.tsx`, `TranslationPanel.tsx`             | Bounded Unicode layout, font fitting, rectangles/ellipse, validated local script and atomic linking                              |
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

Команды не клонируют все пиксели каждый раз: неизменённые строки источников/слои разделяются снимками. Расчёт истории учитывает уникальные source/mask строки и smart-content. Минимальный текущий/предыдущий снимок может быть больше целевого бюджета; это явно указано в настройках. При общем превышении сокращается undo неактивных вкладок, а не их текущие документы.

Кэшируется только неизменённый нижний prefix. Стек с группами/обтравкой или исходный PSD-композит проходит полный scene path, чтобы cache не менял порядок смешивания. Групповые поверхности создаются по необходимости и в масштабе view; текущие intermediate surfaces ограничены отдельно. Это уменьшает лишнюю работу, но не превращает Canvas 2D в полный GPU/Adobe engine.

## Сохранение PSD

1. Нет изменений + тот же контейнер PSD/PSB + исходные байты доступны → byte-for-byte оригинал.
2. Внешний вид не изменился → native metadata update, сохранение совместимой исходной merged-секции и неизвестных image resources. Layout/color-mode checks не позволяют копировать incompatible PSD/PSB RLE/gray sections.
3. Визуальные изменения → пересборка native layer tree, mask/placement/FX metadata в доступном объёме и реальный merged raster текущего документа.
4. Дополнительный XMP содержит собственный документ, а **не заменяет** пункты 1–3.
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

Браузерные тесты используют **production bundle**, не vite dev. Fixture pixels проверяются отдельно от UI; крупные массивы сравниваются без огромного assert diff. Python psd-tools — независимый reader/compositor. Допуск 2/255 относится только к перечисленным масочным fixtures и учебному манга-процессу; он не доказывает полную Adobe/XnConvert совместимость.

Необходимые дальнейшие направления: реальные проблемные пользовательские PSD, color-managed ICC/16-bit core, больше native adjustment/vector/FX semantics, полноценные text metrics/variable axes, аппаратные perf-бенчмарки. Ограничения текущего выпуска — в `COMPATIBILITY.md`.

## Манга: изоляция задач и воспроизведение

J передаёт worker копии пикселей/масок: исходные preview-буферы не detach. Смена параметров/источника, закрытие и отмена завершают предыдущий worker; поздние ответы игнорируются. Есть вычислительный бюджет алгоритма и внешний 60-секундный тайм-аут. Результат — отдельный растровый слой, не модификация источника. Вариант под верхним текстом использует один и тот же индекс для исключения текста из исходного композита и вставки результата; группы и обтравочные цепочки не разрезаются. Текст, обтравленный к нетекстовой основе ниже стека, остаётся в исходном композите; вставка не создаёт для него новую clipping base.

Предпросмотр держит original/after/overlay canvas. Ползунок меняет compositing clip, не пересобирает RGBA. Кисть интерполирует отрезки, recolor охватывает dirty rectangle, а не всю ROI. E2E считает `putImageData`: перемещение разделителя не пишет RGBA, штрих изменяет лишь ограниченную область. Это проверка объёма работы, не бенчмарк GPU/FPS.

Текстовая подготовка ждёт конкретные FontFace descriptors и ограниченный sample перед layout/export; cold-font E2E задерживает выдачу встроенного Oswald и проверяет первую отрисовку/PSD. Layout ограничен 20 000 символами, 512 строками, 24 000 измерениями, 128 cached entries. Эллипс экспортируется как hard-wrapped native box text с отступами строк, не Adobe path text; точная модель рамки остаётся в XMP.

Рекордер слушает `EditorEvent` после final commit, не каждое движение/клавишу. JSON — только проверяемые данные. Неизвестный включённый шаг блокирует запуск; частичное выполнение не коммитится. Последний 200-й допустимый шаг сохраняется; переполнение в середине составного события создаёт blocker. Draft удаляется лишь после успешного сохранения библиотеки, содержащей ту же запись. При 100 операциях он остаётся отдельно, восстанавливается после удаления ненужной операции. Ошибка квоты не удаляет единственную копию. Перезапуск никогда не запускает запись автоматически.

Док не меняет документ/историю: обработанные локальные клавиши не проходят в глобальные nudges, Escape отменяет resize, tabs не размонтируют редактор сценария. Плавающий док остаётся внутри одного окна приложения.
