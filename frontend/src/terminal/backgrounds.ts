// 终端背景预设：经典深色 + 三款 CSS 纹理（无图片素材，纯 CSS 实现，任何环境下均可渲染）

export type TermBgId = 'classic' | 'grid' | 'dots' | 'gradient' | 'image'

export interface BgPreset {
  id: TermBgId
  name: string
  style: React.CSSProperties
}

export const BACKGROUNDS: Record<string, BgPreset> = {
  classic: {
    id: 'classic',
    name: '经典深色',
    style: { background: '#070d1a' },
  },
  grid: {
    id: 'grid',
    name: '网格',
    style: {
      backgroundColor: '#070d1a',
      backgroundImage:
        'linear-gradient(rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.18) 1px, transparent 1px)',
      backgroundSize: '24px 24px',
    },
  },
  dots: {
    id: 'dots',
    name: '圆点',
    style: {
      backgroundColor: '#070d1a',
      backgroundImage: 'radial-gradient(rgba(148,163,184,0.26) 1.2px, transparent 1.6px)',
      backgroundSize: '18px 18px',
    },
  },
  gradient: {
    id: 'gradient',
    name: '极光渐变',
    style: {
      backgroundColor: '#070d1a',
      backgroundImage:
        'radial-gradient(1200px 520px at 20% -10%, rgba(34,197,94,0.34), transparent 60%), radial-gradient(1000px 480px at 110% 110%, rgba(56,189,248,0.28), transparent 60%), radial-gradient(800px 400px at 80% 10%, rgba(139,92,246,0.20), transparent 60%)',
    },
  },
}

// xterm 画布背景：经典用不透明底色，纹理/图片模式完全透明（由容器承载图案，避免蒙层叠暗纹理）
export const XTERM_BG_CLASSIC = '#070d1a'
export const XTERM_BG_TEXTURE = 'rgba(0, 0, 0, 0)'

// 轮播顺序：经典 → 网格 → 圆点 → 极光渐变（若上传了图片 → 图片）
export const CYCLE_ORDER: TermBgId[] = ['classic', 'grid', 'dots', 'gradient']

export function bgStyle(
  id: TermBgId,
  image?: string,
): React.CSSProperties {
  if (id === 'image' && image) {
    return {
      backgroundImage: `url(${image})`,
      backgroundSize: 'cover',
      backgroundPosition: 'center',
      backgroundRepeat: 'no-repeat',
    }
  }
  return BACKGROUNDS[id]?.style ?? BACKGROUNDS.classic.style
}