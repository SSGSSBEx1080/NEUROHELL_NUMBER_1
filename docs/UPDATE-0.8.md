# ФШ777 ULTRA · 0.8 — стили, градиенты и автоматизация

## База и порядок работы

База — опубликованная 0.7.1, main `20e41cb`. Работа идёт в текущей ветке Arena без изменения её имени. Контрольные точки пушатся после проверок. Старые выпуски/профиль приложения не перезаписываются, автоматическое слияние PR не включается.

Приоритет: данные/рендер/PSD → рабочие свойства/библиотеки → операции/пакетный экспорт → обновлённый интерфейс и оригинальный знак ULTRA → полная регрессия и Windows source + packaged EXE.

## Публичные ориентиры

- Несколько Stroke instances имеют собственные параметры и порядок; редактируемая структура важнее похожей картинки. [3](https://www.photoshopessentials.com/photoshop-text/text-effects/add-multiple-strokes-to-text-in-photoshop/)
- Fill opacity влияет на исходное содержимое, не на независимые эффекты слоя. [6](https://helpx.adobe.com/photoshop/using/layer-opacity-blending.html)
- Layer styles включают stroke, inner/outer shadow/glow, overlays и bevel; наличие названия не доказывает одинаковый алгоритм. [1](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/layer-style-effects-and-options-overview.html)
- Blend If задаёт диапазоны текущего/нижнего слоя, разделённые пороги дают плавный переход. [4](https://helpx.adobe.com/photoshop/desktop/create-manage-layers/apply-layer-effects/use-advanced-blending-options.html)
- Noise gradients задают roughness, модель компонентов, диапазоны, transparency и seed/randomize. [14](https://helpx.adobe.com/sg/photoshop/using/gradients.html)
- Anti-aliasing — параметр текстового слоя, влияющий на края. [1](https://helpx.adobe.com/photoshop/desktop/text-typography/get-started-with-text/apply-anti-aliasing-to-a-type-layer.html)
- Batch применяет операцию к набору файлов; выбор назначения и последствия записи должны быть явными. [3](https://helpx.adobe.com/photoshop/desktop/automate-tasks/process-a-batch-of-files/batch-process-files.html)

Это исследование поведения, не копирование Adobe-кода/ресурсов или заявление полного паритета. ICC-конверсия sGray/sRGB, закрытые AI/плагины и неизвестные команды не объявляются выполненными через похожий RGB-фильтр.

## План проверяемых блоков

1. Общий ограниченный редактор градиентов: цвет/alpha/позиции/середины, формы, библиотека/обмен, seeded noise RGB/HSB/Lab и честный PSD-контракт.
2. Новый стек стилей: несколько обводок/теней/наложений, внутренние эффекты, правильный Fill, масштаб/копирование/библиотека, осмысленный предпросмотр и native FX. Старые стили остаются читаемыми.
3. Дополнительные параметры текста/наложения с реальным рендером; запись поддержанных параметров и явные blockers для неподдержанного.
4. Последовательная пакетная обработка с проверками, журналом, отменой и безопасным выводом копий без неявной перезаписи входных файлов.
5. Собственный векторный логотип и оформление «ФШ777 ULTRA», читаемые панели и цвета. Игровое настроение — только оформление, не навязывание применения редактора.

## Состояние

Зависимости восстановлены, исходный npm audit — 0 уязвимостей. Реализация и испытания пунктов отмечаются ниже по мере завершения, а не считаются готовыми из этого плана.
