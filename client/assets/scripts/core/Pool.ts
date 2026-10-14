/**
 * 极简对象池：省去割草玩法高频 instantiate/destroy。
 * 语义与引擎 NodePool 一致（get/put），但不绑定 Node 类型，
 * 敌人/子弹/经验珠的数据体都能池化。Day 1 优先用这个，
 * 因为它对返回类型没有版本差异（NodePool.get() 在 3.x 各小版本签名有出入）。
 */
export class Pool<T> {
    private _free: T[] = [];
    private _createFn: () => T;

    constructor(createFn: () => T, prewarm = 0) {
        this._createFn = createFn;
        for (let i = 0; i < prewarm; i++) {
            this._free.push(createFn());
        }
    }

    get(): T {
        const obj = this._free.pop();
        return obj !== undefined ? obj : this._createFn();
    }

    put(obj: T): void {
        this._free.push(obj);
    }

    get idleCount(): number {
        return this._free.length;
    }
}
