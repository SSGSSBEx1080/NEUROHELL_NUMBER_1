'use strict'
// Synthetic, task-neutral integration fixture. Not part of the application or its demos.
const { deflateSync } = require('node:zlib')
const { randomUUID } = require('node:crypto')
const table = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0)
  return n >>> 0
})
function chunk(type, data) {
  const label = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  let value = 0xffffffff
  for (const byte of Buffer.concat([label, data])) value = (value >>> 8) ^ table[(value ^ byte) & 255]
  crc.writeUInt32BE((value ^ 0xffffffff) >>> 0)
  return Buffer.concat([length, label, data, crc])
}
function raster(width, height, marked) {
  const bytes = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (width * 4 + 1) + 1 + x * 4
    let r = 242, g = 244, b = 248
    // Exact plain area around the restoration ROI; geometric colour blocks elsewhere.
    if (y > 420 && y < 740 && x > 60 && x < 836) {
      const band = ((x / 48) | 0) % 3
      r = [164, 112, 213][band]; g = [184, 151, 193][band]; b = [220, 195, 165][band]
    }
    if (y > 790 && y < 1030 && x > 610 && x < 825) r = g = b = 253
    if (marked && x >= 155 && x < 306 && y >= 187 && y < 266) {
      // Repeated bars/holes exercise removal and a deterministic clean reference.
      const xx = (x - 155) % 30, yy = (y - 187) % 28
      if (yy < 18 && (xx < 5 || (yy < 4 && xx < 20) || (yy > 12 && xx < 18))) r = g = b = 24
    }
    bytes[i] = r; bytes[i + 1] = g; bytes[i + 2] = b; bytes[i + 3] = 255
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6
  return 'data:image/png;base64,' + Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(bytes)), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64')
}
function textBlocksFixture() {
  const width = 896, height = 1200
  const adjustments = { brightness: 0, contrast: 0, saturation: 0, blur: 0, hue: 0, grayscale: 0, sepia: 0, invert: 0 }
  const layer = (values) => ({id:randomUUID(),name:'Layer',kind:'image',visible:true,locked:false,x:0,y:0,width,height,rotation:0,opacity:1,blendMode:'source-over',color:'#151515',adjustments:{...adjustments},...values})
  const frame = {shape:'rectangle',padding:10,verticalAlign:'middle',autoFit:true,minFontSize:12}
  const first = layer({kind:'text',name:'01 · Текстовый блок',text:'',x:122,y:121,width:214,height:221,fontFamily:'Manrope',fontWeight:600,fontSize:28,textAlign:'center',lineHeight:1.15,letterSpacing:0,textFrame:{...frame}})
  const second = layer({kind:'text',name:'02 · Текстовый блок',text:'Второй\nтекстовый\nблок',x:647,y:820,width:148,height:173,fontFamily:'Manrope',fontWeight:600,fontSize:24,textAlign:'center',lineHeight:1.15,letterSpacing:0,textFrame:{...frame}})
  return {
    version:1,id:randomUUID(),name:'Текстовые блоки — тест',width,height,background:'#ffffff',dpi:72,
    layers:[layer({name:'Тестовое изображение',src:raster(width,height,true)}),layer({name:'Контрольное изображение',src:raster(width,height,false),visible:false,locked:true}),first,second],
    textEntries:[
      {id:randomUUID(),source:'Исходный текст 01',text:'Текстовый\nблок\nдокумента',label:'01',note:'',status:'ready',layerId:first.id},
      {id:randomUUID(),source:'Исходный текст 02',text:second.text,label:'02',note:'',status:'checked',layerId:second.id},
    ],
  }
}
module.exports = { textBlocksFixture }
