import { screen } from 'cc';
import { CAMERA } from '../config/BattleConfig';

/**
 * 当前窗口宽高比。
 * screen.windowSize 是物理像素，DPR 在比值中抵消，直接相除即可。
 * 取不到尺寸时（极端情况）退回 16:9。
 */
export function currentAspect(): number {
    const size = screen.windowSize;
    if (!size || size.width <= 0 || size.height <= 0) {
        return 16 / 9;
    }
    return size.width / size.height;
}

/** 当前相机可见半宽/半高（世界单位）。orthoHeight 固定，半宽随窗口宽高比变化。 */
export function visibleHalfSize(): { halfW: number; halfH: number } {
    const halfH = CAMERA.viewHeight / 2;
    return { halfW: halfH * currentAspect(), halfH };
}
