import { makeLayer, newDocument, uid } from './document'
import { bitmapLayer, loadImage } from './render'
import { mangaTextPresets } from './textLayout'
/** Practice data, not a benchmark of real scanned manga. The base illustration was generated for this project. */
export async function mangaDemoDocument() {
  const width = 896,
    height = 1200,
    doc = newDocument(width, height, 'Последняя доставка · учебная страница', '#ffffff')
  const image = await loadImage('/demo-manga.webp')
  await document.fonts.load('600 28px "Manrope"')
  const c = document.createElement('canvas')
  c.width = width
  c.height = height
  const ctx = c.getContext('2d')!
  ctx.drawImage(image, 0, 0, width, height)
  ctx.fillStyle = '#151515'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.font = '600 28px "Manrope"'
  ;['I THOUGHT', 'THE CITY', 'WAS ASLEEP.'].forEach((text, i) =>
    ctx.fillText(text, 228, 180 + i * 34),
  )
  const scan = bitmapLayer(
    makeLayer({ kind: 'image', name: 'Скан · английский текст для J', width, height }),
    c,
  )
  const reference = makeLayer({
    kind: 'image',
    name: 'Эталон без надписей · скрыт',
    src: '/demo-manga.webp',
    width,
    height,
    visible: false,
    locked: true,
  })
  const first = makeLayer({
    kind: 'text',
    ...mangaTextPresets[0].values,
    name: '01 · Перевод после клининга',
    text: '',
    x: 122,
    y: 121,
    width: 214,
    height: 221,
    fontSize: 28,
  })
  const second = makeLayer({
    kind: 'text',
    ...mangaTextPresets[0].values,
    name: '02 · Последняя доставка',
    text: 'Но одна\nдоставка\nещё ждёт.',
    x: 647,
    y: 820,
    width: 148,
    height: 173,
    fontSize: 24,
  })
  return {
    ...doc,
    layers: [scan, reference, first, second],
    script: [
      {
        id: uid(),
        source: 'I thought the city was asleep.',
        translation: 'Я думал,\nгород уже\nуснул.',
        speaker: 'Курьер',
        note: '1. J: обведи английский текст в верхнем пузыре. 2. Примени клин на новый слой. 3. Нажми «Обновить связанный текст». Рамка уже подготовлена.',
        status: 'translated' as const,
        layerId: first.id,
      },
      {
        id: uid(),
        source: 'But one delivery is still waiting.',
        translation: second.text!,
        speaker: 'Курьер',
        note: 'Этот пузырь уже свёрстан. Измени текст или кегль справа; его можно отменить и сохранить в PSD.',
        status: 'proofread' as const,
        layerId: second.id,
      },
    ],
  }
}
