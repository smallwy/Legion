/** 通用小工具：数值钳制 + 圆周率常量 */
export const TAU = Math.PI * 2;

export function clamp(v: number, min: number, max: number): number {
    return v < min ? min : (v > max ? max : v);
}
