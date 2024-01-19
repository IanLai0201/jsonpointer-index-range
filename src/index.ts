import jsonpointer from 'json-pointer';

export interface SearchResult {
  from: number;
  to: number;
}

export interface ParseResult {
  value: string;
  from: number;
  to: number;
}

/**
 * 跳脫字元
 */
const ESCAPED_CHARS: Record<string, string> = {
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  '/': '/',
  '\\': '\\',
};

class TextWalker {
  private _pos = 0;

  constructor(readonly text: string) {}

  get pos(): number {
    return this._pos;
  }

  get textLength(): number {
    return this.text.length;
  }

  get isDone(): boolean {
    return this.pos >= this.textLength;
  }

  getChar(amount = 0): string {
    const pos = this.pos + amount;

    if (pos >= this.textLength) {
      throw new Error('Over text max index.');
    }
    return this.text[pos];
  }

  next(amount = 1): [string | undefined, number] {
    this._pos += amount;

    return [
      /* avoid use getter, getter if over length will throw error */
      this.text[this.pos],
      this.pos,
    ];
  }

  prev(amount = 1): [string | undefined, number] {
    this._pos -= amount;

    return [
      /* avoid use getter, getter if over length will throw error */
      this.text[this.pos],
      this.pos,
    ];
  }

  walk(step: number, callbackfn: (char: string, pos: number, text: string) => void | false) {
    if (this.pos + step >= this.textLength) {
      throw new Error('walk steps over max length');
    }

    while (step > 0) {
      this.next();

      if (callbackfn(this.getChar(), this.pos, this.text) === false) {
        break;
      }

      step--;
    }
  }
}

class IntervalCounter {
  private from = 0;

  private to = 0;

  private _isStarted = false;

  private _isFinish = false;

  constructor(private walker: TextWalker) {}

  get isFinish() {
    return this._isFinish;
  }

  private get text() {
    return this.walker.text;
  }

  start() {
    if (this._isStarted) {
      throw new Error('Interval counter is started.');
    }
    if (this._isFinish) {
      throw new Error('Interval counter is finish.');
    }

    this.from = this.walker.pos;
    this.to = this.from;
    this._isStarted = true;

    return this.from;
  }

  finish() {
    if (!this._isStarted) {
      throw new Error('Interval counter not start.');
    }
    if (this._isFinish) {
      throw new Error('Interval counter is finish.');
    }

    this.to = this.walker.pos;
    this._isFinish = true;

    return {
      from: this.from,
      to: this.to,
      substring: this.text.substring(this.from, this.to),
    };
  }
}

class JsonPath {
  readonly pathArray: string[];

  private _index = 0;

  constructor(path: string | string[]) {
    this.pathArray = Array.isArray(path) ? path : jsonpointer.parse(path);
  }

  get index(): number {
    return this._index;
  }

  get currentPointer(): string | undefined {
    return this.pathArray[this.index];
  }

  next(): number {
    return ++this._index;
  }

  isLast(): boolean {
    return this.index === this.pathArray.length - 1;
  }
}

/**
 * 是否為空白字元
 *
 * @param char
 * @returns
 */
function isWhitespace(char: string): boolean {
  return /^\s+$/.test(char);
}

/**
 * 是否為有效陣列字串
 *
 * @param jsonString
 * @returns
 */
function isArrayString(jsonString: string): boolean {
  try {
    const _jsonString = jsonString.trim();

    return !!JSON.parse(jsonString) && _jsonString.startsWith('[') && _jsonString.endsWith(']');
  } catch (_) {
    return false;
  }
}

/**
 * 是否為有效 Object 字串
 *
 * @param jsonString
 * @returns
 */
function isObjectString(jsonString: string): boolean {
  try {
    const _jsonString = jsonString.trim();

    return !!JSON.parse(jsonString) && _jsonString.startsWith('{') && _jsonString.endsWith('}');
  } catch (_) {
    return false;
  }
}

/**
 * 檢核JSON字串是否有效(陣列或Object)
 *
 * @param jsonString
 * @returns
 */
function validateJsonString(jsonString: string): boolean {
  return isObjectString(jsonString) || isArrayString(jsonString);
}

/**
 * 處理 unicode
 *
 * @param unicode
 * @returns
 */
function parseUnicode(unicode: string): string {
  return JSON.parse(`"${unicode}"`);
}

/**
 * 查詢 JSON 字串, Path 或 JSON-pointer 的字串 index 範圍
 *
 * @param jsonString JSON 字串 (須為合法的 JSON 字串，檢核失敗 throw Error)
 * @param path path array (objectpath 可透過 lodash.toPath 轉換) 或 JSON-pointer
 * @returns
 */
export function jsonPointerIndexRange(jsonString: string, path: string | string[]): SearchResult {
  if (!validateJsonString(jsonString)) {
    throw new SyntaxError('Pase JSON error.');
  }

  const RESULT: SearchResult = {
    from: 0,
    to: 0,
  };

  const jsonPath = new JsonPath(path);

  // not pass path
  if (!jsonPath.pathArray.length) {
    return RESULT;
  }

  // start entry, parse json string
  const walker = new TextWalker(jsonString);

  while (!walker.isDone) {
    const char = walker.getChar();

    if (isWhitespace(char)) {
      walker.next();
      continue;
    }

    parse(/* start level */ 0);
  }

  return RESULT;

  /**
   * 解析字串
   *
   * pos 會移至字串結束下一個位置
   *
   * @returns
   */
  function parseString(): ParseResult {
    const interval = new IntervalCounter(walker);
    interval.start();

    // append object start char '"'
    let str = walker.getChar();

    // move next pos start parse
    walker.next();
    str += resolveStringValue();

    // append string end char '"'
    str += walker.getChar();
    walker.next();

    const { from, to } = interval.finish();

    return {
      value: str,
      from,
      to,
    };
  }

  /**
   * 解析字串(" " 中間內容)
   *
   * pos 會移至字串結束符號 " 位置
   *
   * @returns
   */
  function resolveStringValue(): string {
    let str = '';

    for (;;) {
      const char = walker.getChar();

      if (char === '"') {
        break;
      } else if (char === '\\') {
        str += resolveEscapedString();
      } else {
        str += char;

        // next pos
        walker.next();
      }
    }

    return str;
  }

  /**
   * 解析跳脫字串
   *
   * pos 會移至字串結束下一個位置
   *
   * @returns
   */
  function resolveEscapedString(): string {
    // move next pos start parse
    walker.next();

    let char = walker.getChar();
    let str = '';

    // escaped char
    if (char in ESCAPED_CHARS) {
      str += ESCAPED_CHARS[char];
    }

    // escaped unicode
    else if (char === 'u') {
      let unicode = `\\${char}`;

      walker.walk(4, (walkChar) => {
        char = walkChar.toLowerCase();
        unicode += char;
      });

      str += parseUnicode(unicode);
    }

    // throw error
    else {
      throw new SyntaxError(
        'Unexpected token ' + walker.getChar() + ' in JSON at position ' + walker.pos
      );
    }

    walker.next();

    return str;
  }

  /**
   * 解析 Object
   *
   * pos 會移至 Object 結束下一個位置
   *
   * @param level JSON-pointer 解析層數
   * @returns
   */
  function parseObject(level: number): ParseResult {
    const interval = new IntervalCounter(walker);
    interval.start();

    // append object start char '{'
    let str = walker.getChar();

    // move next pos start parse
    walker.next();

    loop: for (;;) {
      const char = walker.getChar();

      switch (char) {
        case '}': {
          // end point
          str += char;
          walker.next();
          break loop;
        }
        case '"': {
          // key start
          const { value } = parseObjectKeyValuePair(level);

          str += value;
          break;
        }
        default:
          str += char;
          walker.next();
          break;
      }
    }

    const { from, to } = interval.finish();

    return {
      value: str,
      from,
      to,
    };
  }

  /**
   * 解析 Object Key的值，依照傳入的 level 尋找是否為 JSON-pointer 對應的值
   *
   * pos 會移至 Object 結束下一個位置
   *
   * @param level JSON-pointer 解析層數
   * @returns
   */
  function parseObjectKeyValuePair(level: number): ParseResult {
    const interval = new IntervalCounter(walker);
    interval.start();

    // append object key start char '"'
    let str = walker.getChar();

    // move next pos start parse
    walker.next();
    const key = resolveStringValue();

    str += key;
    // append string end char '"'
    str += walker.getChar();
    walker.next();

    const isPointer = checkIsPointer(key, level);

    loop: for (;;) {
      let char = walker.getChar();
      str += char;
      walker.next();

      switch (char) {
        case ':': {
          // key end point
          for (;;) {
            char = walker.getChar();

            if (!isWhitespace(char)) {
              const { value } = parse(level + 1);

              str += value;
              break loop;
            }

            str += char;
            walker.next();
          }
        }
        default:
          break;
      }
    }

    const { from, to } = interval.finish();

    // is searched
    if (isPointer) {
      Object.assign(RESULT, { from, to });
    }

    return {
      value: str,
      from,
      to,
    };
  }

  /**
   * 解析陣列，依照傳入的 level 尋找是否為 JSON-pointer 對應的值
   *
   * pos 會移至陣列結束下一個位置
   *
   * @param level JSON-pointer 解析層數
   * @returns
   */
  function parseArray(level: number): ParseResult {
    const interval = new IntervalCounter(walker);
    interval.start();

    // append array start char '['
    let str = walker.getChar();

    // move next pos start parse
    walker.next();

    // array item index
    let index = -1;

    loop: for (;;) {
      const char = walker.getChar();

      switch (char) {
        case ']': {
          // end point
          str += char;
          walker.next();
          break loop;
        }
        case ',': {
          str += char;
          walker.next();
          break;
        }
        default: {
          if (!isWhitespace(char)) {
            index++;
            const isPointer = checkIsPointer(index.toString(), level);

            const { value, from, to } = parse(level + 1);

            // is searched
            if (isPointer) {
              Object.assign(RESULT, { from, to });
            }

            str += value;
            break;
          }

          str += char;
          walker.next();
          break;
        }
      }
    }

    const { from, to } = interval.finish();

    return {
      value: str,
      from,
      to,
    };
  }

  /**
   * 解析
   *
   * @param level
   * @returns
   */
  function parse(level: number): ParseResult {
    const interval = new IntervalCounter(walker);
    interval.start();

    let str = '';
    let char = walker.getChar();

    switch (char) {
      case '"': {
        // parse string
        const { value } = parseString();

        str += value;

        break;
      }
      case '[': {
        // parse array
        const { value } = parseArray(level);

        str = value;

        break;
      }
      case '{': {
        // pase object
        const { value } = parseObject(level);

        str = value;

        break;
      }
      default: {
        // other
        str += char;

        // move next pos start parse
        walker.next();

        for (;;) {
          char = walker.getChar();

          if (
            isWhitespace(char) ||
            /* esc when object or array close char, array next */
            ['}', ']', ','].includes(char)
          ) {
            break;
          }

          str += char;
          walker.next();
        }

        break;
      }
    }

    const { from, to } = interval.finish();

    return {
      value: str,
      from,
      to,
    };
  }

  /**
   * 確認是否為 JSON-pointer 的值
   *
   * @param key
   * @param level
   * @returns
   */
  function checkIsPointer(key: string, level: number): boolean {
    if (level === jsonPath.index) {
      if (key === jsonPath.currentPointer) {
        // is last pointer
        const searched = jsonPath.isLast();

        // move to next pointer
        jsonPath.next();

        return searched;
      }
    }

    return false;
  }
}
