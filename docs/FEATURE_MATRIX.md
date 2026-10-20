# ФШ777 ULTRA 0.8 · Карта функциональности

Это карта фактически реализованных направлений, **не утверждение об эквивалентности Photoshop 2026 и не исчерпывающий список каждой его кнопки**. Собственный код и интерфейс; закрытый Adobe engine/ресурсы не копируются. Ориентир — публичное руководство и официальные release notes, включая v27.11 за сентябрь 2026. [3](https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html)

| Направление                  | Состояние 0.8                                                                          | Существенная граница                                                                                 |
| ---------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Самостоятельное приложение   | Windows x64 installer / ZIP, без Node/сервера                                            | Неподписанный prerelease; Linux/macOS/ARM64 бинарники не выпускаются                                 |
| Документы                    | Главная, новый/open/recents/recovery, шесть вкладок                                      | Холст 4096², 100 слоёв; не многогигабайтный PSB                                                      |
| История                      | Undo/redo/travel, отдельная история вкладок, snapshots выделений                         | Восстановление history после перезапуска не заявляется; bounded memory                               |
| Слои                         | Пиксели/type/vector/groups/clipping/opacity/lock/reorder                                 | Не все Adobe blending/group semantics                                                                |
| Наложение                    | 17 Canvas/W3C режимов                                                                    | Не все Photoshop modes, blend-if/knockout отсутствуют                                                |
| Текст                        | Измеренные point bounds, paragraph/ellipse frames, typography, fonts                     | Нет rich multi-style/vertical/path type, полного OpenType/variable-axis интерфейса                   |
| Фигуры                       | Примитивы, четыре радиуса, stroke alignment/dash/cap/join, native PSD                    | P/A: native кривые/узлы/усики/компоненты; до 2048. Arbitrary Boolean/path text/warp-node editing нет |
| Трансформации                | Move/resize/rotate/flip/skew/perspective, Alt-copy, Ctrl/Shift                           | Нет полной mesh-warp/puppet warp/liquify реализации                                                  |
| Компоновка                   | Ctrl/Shift-выбор, 6 align + 4 distribute, subtree-aware atomic undo                      | Общая свободная трансформация мультивыбора не добавлена                                              |
| Направляющие                 | Из линеек/px/%, edit/lock/color/hide, layout columns/rows, native PSD                    | До 200; view/color/subdivision параметры дополнительно XMP                                           |
| Сетка / snapping             | Разные X/Y шаги, подразделения, guide/grid/layer/document targets                        | Не artboards/slices/полный Adobe measurement workspace                                               |
| Размеры холста               | Resize image/canvas, 9 anchors, crop с сохранением скрытого содержимого                  | Не полный resampling/print-color pipeline                                                            |
| Выделения                    | Marquee/ellipse/3 lasso, add/subtract/intersect, invert/reselect                         | Это pixel coverage, не semantic object selection                                                     |
| Палочка W                    | Connected/global matching, active layer/composite, tolerance                             | Локальное RGB-сравнение, не Select Subject/Select People                                             |
| Color Range                  | 8 samples, fuzziness, shadows/midtones/highlights, invert                                | Нет skin/face/out-of-gamut/Adobe localized-cluster equivalence                                       |
| Изменение выделения          | Euclidean expand/contract, border, smooth, feather                                       | Радиус ≤100; Gaussian approximation; 20 s worker deadline                                            |
| Быстрая маска Q              | Реальная кисть/ластик по coverage, soft brush, undo                                      | Не native alpha-channel library; временная selection не сериализуется в PSD                          |
| Маски слоя                   | Paint/density/feather/link/disable/invert/reveal/hide                                    | Сложные Adobe vector/real masks — сохранение исходников/предупреждения                               |
| Корректирующие слои          | 15 native records; прежние 12 + RGB Photo Filter, classic Gradient Map и RGB CUBE        | Нет новых Adobe Light/Clarity/Dehaze/Grain, arbitrary LUT/Selective Color/ICC/новых gradient methods |
| Точность tone                | Независимый пересчёт нескольких native RGB/8 fixtures                                    | Не доказана произвольная Adobe/ICC/16-bit эквивалентность                                            |
| Смарт-содержимое             | Embedded PSD, отдельная вкладка/Apply/undo; native XMP-free subset                       | Guarded depth/budgets; arbitrary linked AI/PDF/warp/filter/animation не раскрываются                 |
| Фильтры                      | 6 CPU-фильтров на явной копии с оригиналом, preview/cancel/selection                     | До 8 Мп; не native Adobe Smart Filter stack                                                          |
| Стили                        | Упорядоченный стек: до 10 stroke/drop\+inner shadow/color\+gradient overlay, outer+inner glow, Fill только для содержимого, масштаб эффектов, библиотека и copy/paste; native multi-FX в PSD | Нет bevel/satin/pattern/contour; обводка только цветом (не градиент/узор); отключённые в PSD экземпляры после правки не сохраняются; полного Adobe FX engine нет |
| Градиенты                    | Цвет+alpha точки, середины, библиотека/обмен JSON, seeded noise RGB/HSB/Lab, 4 формы инструмента, те же данные в gradient overlay и карте градиента | Собственный алгоритм шума (не Adobe); HSL из PSD редактируется как HSB; наложение градиента в стилях только линейное |
| Кисти                        | Size/opacity/hardness/spacing, eraser, clone, bucket, gradient                           | Не полная ABR/brush dynamics/pen-pressure/mixer-brush система                                        |
| Восстановление J             | Локальный smooth/exemplar worker, donors/preview/new layer                               | Не генеративный Remove/Firefly; потерянный рисунок не гарантируется                                  |
| Операции и пакет             | Проверяемая запись/replay, параметры type/vector/correction/styles, shortcuts, JSON, ATN subset; пакет до 50 файлов только в копии с журналом и отменой | Selection/pixels/masks/multi-object edits остаются явными blockers; операция пакета начинается с верхнего доступного слоя |
| Поиск                        | Ctrl+F, реальные команды/tools/actions, aliases, раскладка, recents                      | Не Adobe Discover/онлайн-база уроков/AI Assistant                                                    |
| PSD/PSB                      | Native supported structures, merged, original preservation, SHA-256 stale-XMP check      | Не universal import/export fidelity; Photoshop/XnConvert не запускались                              |
| Экспорт                      | PNG/JPEG/WebP/PSD/PSB, CUBE верхнего color stack, scale/background, backup .777          | Нет полного PDF/SVG/TIFF/RAW/print delivery pipeline                                                 |
| Цвет                         | Рабочий RGB/8, сохранение совместимых исходных ICC resources                             | Нет CMYK/Lab/HDR/16–32-bit/soft-proof/color-managed core                                             |
| Генеративный AI / neural     | Не реализован                                                                            | Нужны отдельные лицензированные модели/инфраструктура и проверка; нет фиктивных кнопок               |
| Cloud / plugins / video / 3D | Не реализовано                                                                           | Отдельные архитектурные направления                                                                  |

## Текстовые блоки и рабочая среда

Переиспользуемое содержимое, метки, заметки, состояния, связь со слоем и обмен `.777texts.json`. Старые записи/настройки мигрируют без подмены пользовательских данных. Главная не запускает учебные задания, а методы восстановления и свойства рамок описаны как общие инструменты.

## Дополнения 0.8 ULTRA

- Порядок экземпляров эффектов — часть данных, а не только картинки: список сверху вниз = сверху вниз по стеку отрисовки; то же сохраняется порядком дескрипторов PSD.
- Старые одиночные стили и двухцветные градиенты 0.7 мигрируют в одноэлементные списки и настоящие точки без изменения параметров.
- Пакет никогда не пишет поверх входного файла: веб — скачивание копий, desktop — выбранная папка по непрозрачному id и запрет перезаписи на уровне основного процесса.
- Брендинг ULTRA не меняет appId/профиль: прежние недавние проекты и настройки остаются на месте.

## Дополнения 0.7

- Арифметика и относительные вычисления в числовых полях, Escape без пустого undo, точная модель при фокусе; не общий cm/mm/inch pipeline.
- Карта градиента: 2–16 непрозрачных точек и classic/v1 native record, не geometric gradient fill фигуры.
- CUBE import/export 2–33³ / 2 МиБ; экспорт верхних глобальных коррекций 17³/33³. Spatial masks/clipping/FX блокируются, а не забываются.
- Native path bounds/mask placement, XMP-free node edits, safe SFNT font-name fallback. Незавершённое перо не является сохранённым слоем.

## Почему такой порядок

Сначала — подлинные данные слоя, предсказуемая геометрия, маски, compositing и undo; затем удобство операций. Название кнопки не считается реализацией. Каждый checkpoint отправляется на GitHub; Windows-публикация следует за запуском исходного приложения и упакованного EXE.

Тесты не подменяют внешнюю сертификацию: `tests/unit`, `tests/e2e`, `tests/interop/check_psd.py`, `tests/desktop/smoke.cjs`. Детали и точные пределы — [COMPATIBILITY](COMPATIBILITY.md), ход работы — [UPDATE-0.8](UPDATE-0.8.md).

Следующие крупные самостоятельные направления: проблемные пользовательские PSD/ICC, rich/path text и полный Boolean/vector workflow, полноценный multi-transform, дополнительные native smart filters, brush dynamics, channels и color-managed higher-bit-depth pipeline. Наличие плана не означает, что эти функции уже доступны.
