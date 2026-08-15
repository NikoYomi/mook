// 终端背景预设：经典深色 + 三款 CSS 纹理（无图片素材，纯 CSS 实现，任何环境下均可渲染）

export type TermBgId = 'classic' | 'grid' | 'dots' | 'gradient' | 'matrix' | 'scanlines' | 'stars' | 'waves' | 'image'

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
  matrix: {
    id: 'matrix',
    name: '层叠山峦',
    style: {
      backgroundColor: '#0a1420',
      backgroundImage:
        'radial-gradient(80% 55% at 30% 118%, rgba(30,58,95,0.55), transparent 62%), radial-gradient(70% 45% at 70% 122%, rgba(20,45,80,0.55), transparent 62%), radial-gradient(60% 38% at 50% 128%, rgba(56,189,248,0.22), transparent 60%), radial-gradient(130% 60% at 50% 135%, rgba(34,197,94,0.12), transparent 65%)',
    },
  },
  scanlines: {
    id: 'scanlines',
    name: '电路板',
    style: {
      backgroundColor: '#0b1512',
      backgroundImage:
        'linear-gradient(115deg, transparent 38%, rgba(34,197,94,0.05) 38%, rgba(34,197,94,0.05) 38.6%, transparent 38.6%), linear-gradient(115deg, transparent 62%, rgba(34,197,94,0.04) 62%, rgba(34,197,94,0.04) 62.6%, transparent 62.6%), radial-gradient(rgba(34,197,94,0.22) 1px, transparent 1.6px), radial-gradient(700px 400px at 80% 0%, rgba(56,189,248,0.10), transparent 60%), radial-gradient(600px 360px at 10% 110%, rgba(34,197,94,0.14), transparent 60%)',
      backgroundSize: '100% 100%, 100% 100%, 26px 26px, 100% 100%, 100% 100%',
    },
  },
  stars: {
    id: 'stars',
    name: '星空',
    style: {
      backgroundColor: '#05070f',
      backgroundImage:
        'radial-gradient(1px 1px at 20% 30%, rgba(255,255,255,0.9) 50%, transparent 51%), radial-gradient(1px 1px at 70% 60%, rgba(255,255,255,0.7) 50%, transparent 51%), radial-gradient(1.5px 1.5px at 40% 80%, rgba(226,232,240,0.8) 50%, transparent 51%), radial-gradient(1px 1px at 85% 20%, rgba(255,255,255,0.6) 50%, transparent 51%), radial-gradient(1px 1px at 10% 70%, rgba(226,232,240,0.7) 50%, transparent 51%), radial-gradient(900px 500px at 50% 120%, rgba(56,189,248,0.10), transparent 60%)',
      backgroundSize: '140px 140px, 180px 180px, 220px 220px, 160px 160px, 200px 200px, 100% 100%',
    },
  },
  waves: {
    id: 'waves',
    name: '波浪',
    style: {
      backgroundColor: '#062031',
      backgroundImage:
        'radial-gradient(120% 60% at 50% 110%, rgba(34,197,94,0.25), transparent 60%), radial-gradient(100% 50% at 50% 120%, rgba(56,189,248,0.22), transparent 65%), repeating-radial-gradient(ellipse at 50% 120%, transparent 0, transparent 24px, rgba(148,163,184,0.08) 24px, rgba(148,163,184,0.08) 25px)',
    },
  },
}

// xterm 画布背景：经典用不透明底色，纹理/图片模式完全透明（由容器承载图案，避免蒙层叠暗纹理）
export const XTERM_BG_CLASSIC = '#070d1a'
export const XTERM_BG_TEXTURE = 'rgba(0, 0, 0, 0)'

// 轮播顺序：经典 → 网格 → 圆点 → 极光渐变 → 层叠山峦 → 电路板 → 星空 → 波浪（若上传了图片 → 图片）
export const CYCLE_ORDER: TermBgId[] = ['classic', 'grid', 'dots', 'gradient', 'matrix', 'scanlines', 'stars', 'waves']

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