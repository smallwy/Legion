import { Color } from 'cc';

/**
 * hex(0xRRGGBB) -> Color（0-255 分量）。
 * 注意：Graphics.fillColor / strokeColor 赋值时会拷贝颜色，
 * 因此渲染热路径可以预创建一组 Color 复用，实现零分配。
 */
export function hexColor(hex: number, alpha = 255): Color {
    return new Color((hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, alpha);
}
