/**
 * cc 模块类型桩（仅用于沙箱内静态检查，不属于 Cocos 工程内容）。
 * 目的：在无法运行 Cocos Creator 编辑器的环境下，用 tsc --noEmit 抓出
 * 脚本里的语法错误、跨文件引用错误、明显类型错误。
 * 桩里的 API 签名与 Cocos Creator 3.8.0 引擎源码核对过（graphics/label/screen/camera/input）。
 * 真机的 .d.ts 由编辑器生成（temp/declarations），以此桩为准会有出入，以引擎为准。
 */
declare module 'cc' {
  export const _decorator: {
    ccclass: (name?: string) => ClassDecorator;
    property: (...args: any[]) => PropertyDecorator;
  };

  export class Component {
    node: Node;
    onLoad?(): void;
    start?(): void;
    update?(dt: number): void;
    lateUpdate?(dt: number): void;
    onDestroy?(): void;
  }

  export class Node {
    constructor(name?: string);
    name: string;
    active: boolean;
    parent: Node | null;
    readonly children: Node[];
    addChild(child: Node): void;
    removeFromParent(): void;
    setSiblingIndex(index: number): void;
    setPosition(x?: number, y?: number, z?: number): void;
    setScale(x: number, y?: number, z?: number): void;
    addComponent<T extends Component>(cls: new (...args: any[]) => T): T;
    getComponent<T extends Component>(cls: new (...args: any[]) => T): T | null;
  }

  export class UITransform extends Component {
    setContentSize(width: number, height: number): void;
    width: number;
    height: number;
  }
  export class UIOpacity extends Component {}

  export class Color {
    constructor(r?: number, g?: number, b?: number, a?: number);
    r: number;
    g: number;
    b: number;
    a: number;
  }

  export class Camera extends Component {
    projection: number;
    orthoHeight: number;
    near: number;
    far: number;
    clearFlags: number;
    clearColor: Color;
    static ProjectionType: { ORTHO: number; PERSPECTIVE: number };
    static ClearFlag: { SOLID_COLOR: number; DEPTH_ONLY: number; DONT_CLEAR: number };
  }

  export class Graphics extends Component {
    fillColor: Color;
    strokeColor: Color;
    lineWidth: number;
    lineJoin: number;
    lineCap: number;
    moveTo(x: number, y: number): void;
    lineTo(x: number, y: number): void;
    arc(cx: number, cy: number, r: number, startAngle: number, endAngle: number, counterclockwise: boolean): void;
    circle(x: number, y: number, r: number): void;
    ellipse(cx: number, cy: number, rx: number, ry: number): void;
    rect(x: number, y: number, w: number, h: number): void;
    roundRect(x: number, y: number, w: number, h: number, r: number): void;
    close(): void;
    fill(): void;
    stroke(): void;
    clear(): void;
  }

  export class Label extends Component {
    string: string;
    fontSize: number;
    lineHeight: number;
    color: Color;
    horizontalAlign: number;
    verticalAlign: number;
    overflow: number;
    static HorizontalAlign: { LEFT: number; CENTER: number; RIGHT: number };
    static VerticalAlign: { TOP: number; CENTER: number; BOTTOM: number };
    static Overflow: { NONE: number; CLAMP: number; RESIZE_HEIGHT: number; SHRINK: number };
  }

  export class Sprite extends Component {
    spriteFrame: SpriteFrame | null;
    color: Color;
    type: number;
    static Type: { SIMPLE: number; SLICED: number; TILED: number; FILLED: number };
  }

  export class SpriteFrame {
    texture: Texture2D | null;
  }

  export class Texture2D {
    width: number;
    height: number;
  }

  export const input: {
    on(type: number, callback: (event: any) => void, target?: any): void;
    off(type: number, callback: (event: any) => void, target?: any): void;
  };

  export class Input {
    static EventType: {
      KEY_DOWN: number;
      KEY_UP: number;
      KEY_PRESSING: number;
      MOUSE_DOWN: number;
      MOUSE_UP: number;
      MOUSE_MOVE: number;
      TOUCH_START: number;
      TOUCH_END: number;
    };
  }

  export class EventKeyboard {
    keyCode: number;
  }

  export class KeyCode {
    static KEY_W: number;
    static KEY_A: number;
    static KEY_S: number;
    static KEY_D: number;
    static KEY_E: number;
    static KEY_F: number;
    static DIGIT_1: number;
    static DIGIT_2: number;
    static DIGIT_3: number;
    static SPACE: number;
    static ESC: number;
    static ARROW_UP: number;
    static ARROW_DOWN: number;
    static ARROW_LEFT: number;
    static ARROW_RIGHT: number;
  }

  export const resources: {
    load(path: string, type: any, callback: (err: any, asset: any) => void): void;
  };

  export const screen: {
    windowSize: { width: number; height: number };
  };
}
