# ФШ777 0.6 · Рабочий журнал

Начальная база: main `1ad29b5`, выпущенная 0.5.0. Работа идёт в `arena/e28da5b6-neurohell-number-1`. Выпуски 0.3–0.5 не переписываются. Этот журнал описывает ход разработки, не обещает завершение всех пунктов и не объявляет бинарный выпуск до Windows-проверок.

## Карта возможностей и независимая реализация

Изучены публичные материалы Adobe по состоянию на 19 октября 2026. Заимствуются описания поведения и общепринятые рабочие операции, не код, оформление, иконки или ресурсы Adobe. Полная функциональная эквивалентность Photoshop не заявляется.

| Область | Что уже есть в 0.5 | Приоритет 0.6 / дальнейший маршрут |
| --- | --- | --- |
| Документы и PSD | вкладки, история, восстановление, native text/vector/groups/masks/smart | сохранить регрессионные гарантии, новые native adjustment structures |
| Цвет и тон | скалярные коррекции отдельного слоя | настоящие корректирующие слои, levels/curves, RGB-каналы, гистограмма, clipping/masks |
| Выделения | рамка/эллипс, три лассо, инверсия/feather | сложение/вычитание/пересечение, выбор по цвету, расширение/сужение/граница |
| Компоновка | трансформации, привязка к центрам, линейки | направляющие/сетка/макет направляющих, точная привязка, native PSD guides |
| Операции | проверяемая запись/replay, ATN subset, shortcuts | поиск команд, доступ к новым функциям из меню и свойств |
| Ретушь/фильтры | кисть/штамп/J/градиент/заливка, базовые фильтры | дальнейшее расширение локальных алгоритмов, без утверждений об Adobe/AI fidelity |
| Новые Adobe AI-функции | не реализованы | требуют отдельной модели, лицензии/инфраструктуры и испытаний; никаких фиктивных кнопок |
| Camera Raw / CMYK / Lab / HDR / плагины | не реализованы | отдельные большие проекты, не скрытая часть текущего выпуска |

### Источники

1. Официальные release notes: новые функции, в том числе сентябрь 2026, v27.11. [3](https://helpx.adobe.com/photoshop/desktop/whats-new/photoshop-on-desktop-release-notes.html)
2. Корректирующие слои: уровни, кривые, экспозиция, H/S, баланс цвета, B&W, mixer, invert/posterize/threshold и другое. [2](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/work-with-adjustment-and-fill-layers.html)
3. Коррекции воздействуют на нижний стек, параметры остаются редактируемыми. [6](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjustment-and-fill-layers-overview.html)
4. Выделение превращается в маску новой коррекции, возможна дальнейшая правка маски. [11](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/use-layer-masks-to-target-adjustment-or-fill-layers.html)
5. Множественный выбор слоёв, Shift/Ctrl и операции над несколькими слоями. [8](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/transform-manipulate-layers/select-layers.html)
6. Новый Light adjustment объединяет exposure/contrast/highlights/shadows/whites/blacks; это ориентир дальнейшей работы, не уже реализованная Adobe-модель. [14](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/color-adjustment-fill-layers/adjust-image-lighting-with-light.html)

Наличие одинакового имени/PSD-дескриптора не доказывает совпадение цветового алгоритма Adobe. Проверяются собственная математическая модель, compositing, сохранность структуры без XMP и merged image. Реальный Photoshop отдельно не запускался.

## Этап 1 · Подготовка

- Чистая база после PR №3; активная ветка проверена.
- Зависимости установлены по lockfile; npm audit сообщает 0 уязвимостей.
- Зафиксирована карта работ. Следующий checkpoint — движок и интерфейс корректирующих слоёв с проверками.
