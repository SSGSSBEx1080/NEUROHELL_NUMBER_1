import type { Quad } from '../types'
import { homography, invertMatrix } from './projection'

interface Pixels {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** Deterministic inverse mapping for machines without WebGL. Interpolate PREMULTIPLIED
 * channels: transparent texels must neither darken RGB nor accumulate alpha at seams. */
export function projectPixels(
  source: Pixels,
  width: number,
  height: number,
  quad: Quad,
): Uint8ClampedArray {
  const inverse = invertMatrix(homography(quad)),
    result = new Uint8ClampedArray(width * height * 4)
  const { data, width: sw, height: sh } = source
  for (let y = 0; y < height; y++) {
    let nx = inverse[0] * 0.5 + inverse[1] * (y + 0.5) + inverse[2]
    let ny = inverse[3] * 0.5 + inverse[4] * (y + 0.5) + inverse[5]
    let denominator = inverse[6] * 0.5 + inverse[7] * (y + 0.5) + inverse[8]
    for (let x = 0; x < width; x++, nx += inverse[0], ny += inverse[3], denominator += inverse[6]) {
      if (Math.abs(denominator) < 1e-12) continue
      const u = nx / denominator,
        v = ny / denominator
      if (u < 0 || v < 0 || u > 1 || v > 1) continue
      const sx = u * sw - 0.5,
        sy = v * sh - 0.5,
        ix = Math.floor(sx),
        iy = Math.floor(sy)
      const tx = sx - ix,
        ty = sy - iy
      const x0 = Math.max(0, Math.min(sw - 1, ix)),
        x1 = Math.max(0, Math.min(sw - 1, ix + 1))
      const y0 = Math.max(0, Math.min(sh - 1, iy)),
        y1 = Math.max(0, Math.min(sh - 1, iy + 1))
      const p = (y0 * sw + x0) * 4,
        q = (y0 * sw + x1) * 4,
        r = (y1 * sw + x0) * 4,
        s = (y1 * sw + x1) * 4
      const a = data[p + 3] * (1 - tx) * (1 - ty),
        b = data[q + 3] * tx * (1 - ty),
        c = data[r + 3] * (1 - tx) * ty,
        d = data[s + 3] * tx * ty,
        alpha = a + b + c + d
      const target = (y * width + x) * 4
      result[target + 3] = Math.round(alpha)
      if (alpha > 0)
        for (let channel = 0; channel < 3; channel++)
          result[target + channel] = Math.round(
            (data[p + channel] * a +
              data[q + channel] * b +
              data[r + channel] * c +
              data[s + channel] * d) /
              alpha,
          )
    }
  }
  return result
}

interface GpuProjector {
  canvas: HTMLCanvasElement
  gl: WebGLRenderingContext
  program: WebGLProgram
  vertex: WebGLBuffer
  elements: WebGLBuffer
  texture: WebGLTexture
  position: number
  uv: number
}
let projector: GpuProjector | null | undefined
function createProjector(): GpuProjector | null {
  const canvas = document.createElement('canvas')
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: true,
    antialias: true,
    depth: false,
    stencil: false,
    preserveDrawingBuffer: true,
  })
  if (!gl) return null
  const compile = (type: number, code: string) => {
    const shader = gl.createShader(type)!
    gl.shaderSource(shader, code)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader)
      return null
    }
    return shader
  }
  const vertexShader = compile(
    gl.VERTEX_SHADER,
    `
    attribute vec3 position;
    attribute vec2 uv;
    varying vec2 textureUV;
    void main() { gl_Position = vec4(position.xy, 0.0, position.z); textureUV = uv; }
  `,
  )
  const fragmentShader = compile(
    gl.FRAGMENT_SHADER,
    `
    precision highp float;
    uniform sampler2D image;
    varying vec2 textureUV;
    void main() { gl_FragColor = texture2D(image, textureUV); }
  `,
  )
  if (!vertexShader || !fragmentShader) return null
  const program = gl.createProgram()!
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
  const vertex = gl.createBuffer()!,
    elements = gl.createBuffer()!,
    texture = gl.createTexture()!
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault()
    projector = null
  })
  return {
    canvas,
    gl,
    program,
    vertex,
    elements,
    texture,
    position: gl.getAttribLocation(program, 'position'),
    uv: gl.getAttribLocation(program, 'uv'),
  }
}

/** Two triangles with perspective-correct interpolation and NO source-over overlap.
 * One reusable GL context; the returned cache is ordinary Canvas2D, not a live GL view. */
export function projectTexture(
  source: HTMLCanvasElement,
  output: HTMLCanvasElement,
  quad: Quad,
): 'webgl' | 'cpu' {
  if (projector === undefined) {
    try {
      projector = createProjector()
    } catch {
      projector = null
    }
  }
  const target = output.getContext('2d')!
  if (projector) {
    try {
      const { canvas, gl, program, vertex, elements, texture, position, uv } = projector
      if (gl.isContextLost()) throw new Error('Context lost')
      const size = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number
      if (
        source.width > size ||
        source.height > size ||
        output.width > size ||
        output.height > size
      )
        throw new Error('Texture size')
      if (canvas.width !== output.width) canvas.width = output.width
      if (canvas.height !== output.height) canvas.height = output.height
      const matrix = homography(quad),
        vertices: number[] = []
      for (const [u, v] of [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ]) {
        const w = matrix[6] * u + matrix[7] * v + 1
        if (w <= 1e-8) throw new Error('Projective horizon')
        vertices.push(
          (2 * (matrix[0] * u + matrix[1] * v + matrix[2])) / output.width - w,
          w - (2 * (matrix[3] * u + matrix[4] * v + matrix[5])) / output.height,
          w,
          u,
          v,
        )
      }
      gl.viewport(0, 0, output.width, output.height)
      gl.disable(gl.BLEND)
      gl.disable(gl.DEPTH_TEST)
      gl.disable(gl.CULL_FACE)
      gl.clearColor(0, 0, 0, 0)
      gl.clear(gl.COLOR_BUFFER_BIT)
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, vertex)
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertices), gl.DYNAMIC_DRAW)
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 3, gl.FLOAT, false, 20, 0)
      gl.enableVertexAttribArray(uv)
      gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 20, 12)
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, elements)
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0, 1, 2, 0, 2, 3]), gl.STATIC_DRAW)
      gl.activeTexture(gl.TEXTURE0)
      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1)
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0)
      gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source)
      gl.uniform1i(gl.getUniformLocation(program, 'image'), 0)
      gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0)
      if (gl.getError() !== gl.NO_ERROR) throw new Error('Texture projection failed')
      target.drawImage(canvas, 0, 0)
      return 'webgl'
    } catch {
      // Context loss / unsupported GPU is a real CPU fallback, not a blank layer.
      projector = null
    }
  }
  const pixels = source.getContext('2d')!.getImageData(0, 0, source.width, source.height)
  target.putImageData(
    new ImageData(
      projectPixels(pixels, output.width, output.height, quad),
      output.width,
      output.height,
    ),
    0,
    0,
  )
  return 'cpu'
}
