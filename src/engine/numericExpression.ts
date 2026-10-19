/** Bounded arithmetic parser. Never eval/Function/JS identifiers or implicit unit conversion. */
export function evaluateNumericInput(input: string, current: number, unit = ''): number {
  if (input.length > 96 || !Number.isFinite(current))
    throw new Error('Выражение должно быть до 96 символов')
  let text = input
    .trim()
    .replace(/−/g, '-')
    .replace(/[×·]/g, '*')
    .replace(/÷/g, '/')
    .replace(/,/g, '.')
  const relative = /^([+\-*/])=/.exec(text)
  if (relative) text = text.slice(2)
  else if (text.startsWith('=')) text = text.slice(1)
  const percent = /^([+\-]?(?:\d+\.?\d*|\.\d+))\s*%$/.exec(text)
  if (!relative && percent) return checked(Number(percent[1]) * (unit === '%' ? 1 : current / 100))
  let at = 0,
    depth = 0
  const skip = () => {
    while (/\s/.test(text[at] || '') && at < text.length) at++
  }
  const factor = (): number => {
    skip()
    if (++depth > 16) throw new Error('Слишком много вложенных скобок или знаков')
    let result: number
    if (text[at] === '+' || text[at] === '-') {
      const sign = text[at++] === '-' ? -1 : 1
      result = sign * factor()
    } else if (text[at] === '(') {
      at++
      result = expression()
      skip()
      if (text[at++] !== ')') throw new Error('Не закрыта скобка')
    } else {
      const number = /^(?:\d+\.?\d*|\.\d+)(?:e[+\-]?\d+)?/i.exec(text.slice(at))
      if (!number) throw new Error('Ожидается число, а не команда или имя')
      at += number[0].length
      result = checked(Number(number[0]))
    }
    skip()
    if (text[at] === '%') {
      at++
      result /= 100
    } else if (unit === 'px' && text.slice(at, at + 2).toLowerCase() === 'px') at += 2
    else if (unit === '°' && text[at] === '°') at++
    else if (unit === '°' && text.slice(at, at + 3).toLowerCase() === 'deg') at += 3
    depth--
    return checked(result)
  }
  const term = (): number => {
    let value = factor()
    skip()
    while (text[at] === '*' || text[at] === '/') {
      const op = text[at++],
        right = factor()
      if (op === '/' && right === 0) throw new Error('Делить на ноль нельзя')
      value = checked(op === '*' ? value * right : value / right)
      skip()
    }
    return value
  }
  const expression = (): number => {
    let value = term()
    skip()
    while (text[at] === '+' || text[at] === '-') {
      const op = text[at++],
        right = term()
      value = checked(op === '+' ? value + right : value - right)
      skip()
    }
    return value
  }
  let result = expression()
  skip()
  if (at !== text.length)
    throw new Error('Разрешены числа, + − × ÷, проценты и скобки; единицы не конвертируются')
  if (relative) {
    const op = relative[1]
    if (op === '/' && result === 0) throw new Error('Делить на ноль нельзя')
    result =
      op === '+'
        ? current + result
        : op === '-'
          ? current - result
          : op === '*'
            ? current * result
            : current / result
  }
  return checked(result)
}
function checked(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) > 1e12)
    throw new Error('Результат вне безопасного числового диапазона')
  return value || 0
}
