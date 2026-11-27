import { z } from 'zod'

export const Vec3Schema = z.tuple([z.number(), z.number(), z.number()])
export type Vec3 = z.infer<typeof Vec3Schema>

export const Scene3DPrimitiveTypeSchema = z.enum([
  'box',
  'sphere',
  'cylinder',
  'cone',
  'torus',
  'wheel',
  'spring',
  'lens',
  'prism',
  'flask',
  'plane',
  'arrow3d',
  'curve3d',
  'surface3d',
  'mesh',
  'label3d'
])
export type Scene3DPrimitiveType = z.infer<typeof Scene3DPrimitiveTypeSchema>

export const Scene3DColorMapSchema = z.enum([
  'viridis',
  'coolwarm',
  'emerald',
  'amber',
  'ocean'
])
export type Scene3DColorMap = z.infer<typeof Scene3DColorMapSchema>

export const Scene3DAnimSchema = z.object({
  rotateSpeed: Vec3Schema.optional(),
  oscillate: z
    .object({
      axis: z.enum(['x', 'y', 'z']),
      amp: z.number(),
      freq: z.number(),
      phase: z.number().optional()
    })
    .optional(),
  pulseFlow: z.boolean().optional()
})
export type Scene3DAnim = z.infer<typeof Scene3DAnimSchema>

export const Scene3DElementSchema = z.object({
  id: z.string().min(1),
  type: Scene3DPrimitiveTypeSchema,
  label: z.string().optional(),
  pos: Vec3Schema.optional(),
  rot: Vec3Schema.optional(),
  scale: Vec3Schema.optional(),
  // Geometry options
  size: Vec3Schema.optional(),
  radius: z.number().positive().optional(),
  radiusTop: z.number().nonnegative().optional(),
  radiusBottom: z.number().nonnegative().optional(),
  tubeRadius: z.number().positive().optional(),
  height: z.number().positive().optional(),
  turns: z.number().min(1).max(32).optional(),
  spokes: z.number().int().min(3).max(16).optional(),
  from: Vec3Schema.optional(),
  to: Vec3Schema.optional(),
  points: z.array(Vec3Schema).optional(),
  // Parametric mathematical surface z = f(x, y, t)
  expr: z.string().optional(),
  xRange: z.tuple([z.number(), z.number()]).optional(),
  zRange: z.tuple([z.number(), z.number()]).optional(),
  resolution: z.number().int().min(6).max(36).optional(),
  colorMap: Scene3DColorMapSchema.optional(),
  // Custom mesh
  vertices: z.array(Vec3Schema).optional(),
  faces: z.array(z.array(z.number().int().nonnegative())).optional(),
  // Labware & optics specifics
  fillLevel: z.number().min(0).max(1).optional(),
  liquidColor: z.string().optional(),
  lensKind: z.enum(['biconvex', 'biconcave', 'plano']).optional(),
  // Label
  text: z.string().optional(),
  fontSize: z.number().min(8).max(40).optional(),
  // Material
  color: z.string().optional(),
  secondaryColor: z.string().optional(),
  opacity: z.number().min(0.05).max(1).optional(),
  wireframe: z.boolean().optional(),
  emissive: z.boolean().optional(),
  dashed: z.boolean().optional(),
  anim: Scene3DAnimSchema.optional()
})
export type Scene3DElement = z.infer<typeof Scene3DElementSchema>

export const Scene3DCameraSchema = z.object({
  yaw: z.number().optional(),
  pitch: z.number().optional(),
  zoom: z.number().min(0.25).max(4).optional(),
  panX: z.number().optional(),
  panY: z.number().optional(),
  autoRotate: z.boolean().optional(),
  autoRotateSpeed: z.number().optional()
})
export type Scene3DCamera = z.infer<typeof Scene3DCameraSchema>

export const Scene3DPresetIdSchema = z.enum([
  'car',
  'optics_bench',
  'mechanics_rig',
  'chemistry_setup',
  'electromagnetism',
  'surface_wave',
  'custom'
])
export type Scene3DPresetId = z.infer<typeof Scene3DPresetIdSchema>

export const Scene3DSpecSchema = z.object({
  title: z.string().optional(),
  preset: Scene3DPresetIdSchema.optional(),
  immersed: z.boolean().optional(),
  showAxes: z.boolean().optional(),
  showGrid: z.boolean().optional(),
  animate: z.boolean().optional(),
  wireframe: z.boolean().optional(),
  camera: Scene3DCameraSchema.optional(),
  elements: z.array(Scene3DElementSchema).default([])
})
export type Scene3DSpec = z.infer<typeof Scene3DSpecSchema>

export interface Scene3DPresetInfo {
  id: Scene3DPresetId
  name: string
  category: 'vehicle' | 'physics' | 'chemistry' | 'math'
  description: string
}

export const SCENE3D_PRESETS: Scene3DPresetInfo[] = [
  {
    id: 'car',
    name: '3D Car & Forces',
    category: 'vehicle',
    description: 'Aerodynamic vehicle with rotating spoke wheels, windshields & force vectors'
  },
  {
    id: 'optics_bench',
    name: 'Optics Bench',
    category: 'physics',
    description: 'Laser source, biconvex glass lens, dispersive prism & animated light rays'
  },
  {
    id: 'mechanics_rig',
    name: 'Mechanics Lab Rig',
    category: 'physics',
    description: 'Inclined ramp, sliding block, helical spring, pendulum & force vectors'
  },
  {
    id: 'chemistry_setup',
    name: 'Chemistry Titration',
    category: 'chemistry',
    description: 'Retort stand, burette with stopcock, Erlenmeyer flask & indicator reaction'
  },
  {
    id: 'electromagnetism',
    name: 'EM Solenoid Field',
    category: 'physics',
    description: 'Copper solenoid coil, current arrows & closed 3D magnetic flux loops'
  },
  {
    id: 'surface_wave',
    name: '3D Wave Surface',
    category: 'math',
    description: 'Animated z = f(x, y, t) interference wave surface plot'
  }
]

export function buildPresetScene3D(presetId: Scene3DPresetId | string): Scene3DSpec {
  const cleanId = presetId.trim().toLowerCase().replace(/[\s-]+/g, '_')

  if (cleanId === 'car' || cleanId === 'vehicle' || cleanId === 'automobile') {
    return {
      title: '3D Car & Kinematics Model',
      preset: 'car',
      immersed: true,
      showAxes: true,
      showGrid: true,
      animate: true,
      camera: { yaw: 36, pitch: 20, zoom: 1.05, autoRotate: false },
      elements: [
        // Asphalt road strip
        {
          id: 'road',
          type: 'plane',
          pos: [0, -0.58, 0],
          size: [7.6, 0.04, 3.2],
          color: '#334155',
          opacity: 0.72
        },
        // Lower chassis body
        {
          id: 'chassis',
          type: 'box',
          pos: [0, -0.04, 0],
          size: [3.9, 0.56, 1.56],
          color: '#EF4444'
        },
        // Front hood wedge/nose
        {
          id: 'hood',
          type: 'box',
          pos: [1.55, -0.1, 0],
          rot: [0, 0, -10],
          size: [1.1, 0.42, 1.5],
          color: '#DC2626'
        },
        // Cabin roof
        {
          id: 'cabin',
          type: 'box',
          pos: [-0.25, 0.46, 0],
          size: [1.9, 0.5, 1.32],
          color: '#B91C1C'
        },
        // Front windshield (glass)
        {
          id: 'windshield-front',
          type: 'box',
          pos: [0.76, 0.42, 0],
          rot: [0, 0, -34],
          size: [0.64, 0.06, 1.24],
          color: '#7DD3FC',
          opacity: 0.55
        },
        // Rear glass
        {
          id: 'windshield-rear',
          type: 'box',
          pos: [-1.24, 0.42, 0],
          rot: [0, 0, 32],
          size: [0.58, 0.06, 1.24],
          color: '#7DD3FC',
          opacity: 0.55
        },
        // Side windows
        {
          id: 'side-windows',
          type: 'box',
          pos: [-0.25, 0.45, 0],
          size: [1.58, 0.34, 1.36],
          color: '#38BDF8',
          opacity: 0.48
        },
        // Spoiler struts & wing
        {
          id: 'spoiler-wing',
          type: 'box',
          pos: [-1.82, 0.44, 0],
          rot: [0, 0, 8],
          size: [0.42, 0.06, 1.52],
          color: '#0F172A'
        },
        {
          id: 'spoiler-strut-l',
          type: 'cylinder',
          pos: [-1.78, 0.32, -0.5],
          radius: 0.04,
          height: 0.24,
          color: '#1E293B'
        },
        {
          id: 'spoiler-strut-r',
          type: 'cylinder',
          pos: [-1.78, 0.32, 0.5],
          radius: 0.04,
          height: 0.24,
          color: '#1E293B'
        },
        // Headlights
        {
          id: 'headlight-l',
          type: 'sphere',
          pos: [2.04, -0.02, -0.52],
          radius: 0.12,
          color: '#FEF08A',
          emissive: true
        },
        {
          id: 'headlight-r',
          type: 'sphere',
          pos: [2.04, -0.02, 0.52],
          radius: 0.12,
          color: '#FEF08A',
          emissive: true
        },
        // 4 Rotating Spoke Wheels
        {
          id: 'wheel-fl',
          type: 'wheel',
          pos: [1.22, -0.22, 0.84],
          radius: 0.36,
          tubeRadius: 0.12,
          spokes: 6,
          color: '#0F172A',
          secondaryColor: '#CBD5E1',
          anim: { rotateSpeed: [0, 0, -2.4] }
        },
        {
          id: 'wheel-fr',
          type: 'wheel',
          pos: [1.22, -0.22, -0.84],
          radius: 0.36,
          tubeRadius: 0.12,
          spokes: 6,
          color: '#0F172A',
          secondaryColor: '#CBD5E1',
          anim: { rotateSpeed: [0, 0, -2.4] }
        },
        {
          id: 'wheel-rl',
          type: 'wheel',
          pos: [-1.22, -0.22, 0.84],
          radius: 0.36,
          tubeRadius: 0.12,
          spokes: 6,
          color: '#0F172A',
          secondaryColor: '#CBD5E1',
          anim: { rotateSpeed: [0, 0, -2.4] }
        },
        {
          id: 'wheel-rr',
          type: 'wheel',
          pos: [-1.22, -0.22, -0.84],
          radius: 0.36,
          tubeRadius: 0.12,
          spokes: 6,
          color: '#0F172A',
          secondaryColor: '#CBD5E1',
          anim: { rotateSpeed: [0, 0, -2.4] }
        },
        // Velocity & Force Vectors
        {
          id: 'vec-vel',
          type: 'arrow3d',
          from: [2.2, 0.12, 0],
          to: [3.55, 0.12, 0],
          color: '#10B981',
          label: 'v = 28 m/s',
          anim: { pulseFlow: true }
        },
        {
          id: 'vec-drag',
          type: 'arrow3d',
          from: [-1.4, 0.65, 0],
          to: [-2.75, 0.65, 0],
          color: '#F59E0B',
          label: 'F_drag'
        },
        {
          id: 'vec-gravity',
          type: 'arrow3d',
          from: [0, -0.05, 0],
          to: [0, -1.25, 0],
          color: '#3B82F6',
          label: 'mg'
        },
        {
          id: 'lbl-vel',
          type: 'label3d',
          pos: [3.6, 0.35, 0],
          text: 'v = 28 m/s',
          color: '#10B981',
          fontSize: 12
        },
        {
          id: 'lbl-drag',
          type: 'label3d',
          pos: [-2.8, 0.9, 0],
          text: 'F_drag = ½ρCdAv²',
          color: '#F59E0B',
          fontSize: 11
        }
      ]
    }
  }

  if (cleanId === 'optics_bench' || cleanId === 'optics' || cleanId === 'laser') {
    return {
      title: '3D Optics Bench (Laser + Lens + Prism)',
      preset: 'optics_bench',
      immersed: true,
      showAxes: false,
      showGrid: true,
      animate: true,
      camera: { yaw: 34, pitch: 22, zoom: 1.02, autoRotate: false },
      elements: [
        // Optical rail / breadboard
        {
          id: 'bench',
          type: 'box',
          pos: [0, -0.65, 0],
          size: [7.4, 0.24, 2.1],
          color: '#1E293B'
        },
        // Laser emitter housing + stand
        {
          id: 'laser-post',
          type: 'cylinder',
          pos: [-2.8, -0.12, 0],
          radius: 0.08,
          height: 0.85,
          color: '#64748B'
        },
        {
          id: 'laser-body',
          type: 'cylinder',
          pos: [-2.8, 0.42, 0],
          rot: [0, 0, -90],
          radius: 0.24,
          height: 1.15,
          color: '#0F172A'
        },
        {
          id: 'laser-aperture',
          type: 'sphere',
          pos: [-2.22, 0.42, 0],
          radius: 0.08,
          color: '#EF4444',
          emissive: true
        },
        // Biconvex Converging Glass Lens + Stand
        {
          id: 'lens-post',
          type: 'cylinder',
          pos: [-0.45, -0.18, 0],
          radius: 0.07,
          height: 0.72,
          color: '#64748B'
        },
        {
          id: 'converging-lens',
          type: 'lens',
          pos: [-0.45, 0.42, 0],
          rot: [0, 90, 0],
          radius: 0.65,
          height: 0.28,
          lensKind: 'biconvex',
          color: '#38BDF8',
          opacity: 0.46
        },
        // Equilateral Dispersive Glass Prism + Pedestal
        {
          id: 'prism-post',
          type: 'cylinder',
          pos: [1.35, -0.22, 0],
          radius: 0.09,
          height: 0.62,
          color: '#64748B'
        },
        {
          id: 'prism',
          type: 'prism',
          pos: [1.35, 0.45, 0],
          size: [0.95, 0.95, 0.85],
          color: '#7DD3FC',
          opacity: 0.48
        },
        // Target Detector Screen
        {
          id: 'screen',
          type: 'box',
          pos: [3.2, 0.35, 0],
          size: [0.1, 1.5, 1.45],
          color: '#F8FAFC'
        },
        // Incident & Refracted Light Rays
        {
          id: 'ray-incident-top',
          type: 'curve3d',
          points: [
            [-2.2, 0.66, 0],
            [-0.45, 0.66, 0],
            [0.65, 0.42, 0],
            [1.1, 0.42, 0]
          ],
          color: '#EF4444',
          anim: { pulseFlow: true }
        },
        {
          id: 'ray-incident-center',
          type: 'arrow3d',
          from: [-2.2, 0.42, 0],
          to: [1.05, 0.42, 0],
          color: '#EF4444',
          anim: { pulseFlow: true }
        },
        {
          id: 'ray-incident-bot',
          type: 'curve3d',
          points: [
            [-2.2, 0.18, 0],
            [-0.45, 0.18, 0],
            [0.65, 0.42, 0],
            [1.1, 0.42, 0]
          ],
          color: '#EF4444',
          anim: { pulseFlow: true }
        },
        // Dispersed rainbow rays exiting prism
        {
          id: 'ray-red',
          type: 'arrow3d',
          from: [1.58, 0.44, 0],
          to: [3.15, 0.65, 0.18],
          color: '#EF4444',
          anim: { pulseFlow: true }
        },
        {
          id: 'ray-green',
          type: 'arrow3d',
          from: [1.58, 0.42, 0],
          to: [3.15, 0.32, 0],
          color: '#10B981',
          anim: { pulseFlow: true }
        },
        {
          id: 'ray-violet',
          type: 'arrow3d',
          from: [1.58, 0.39, 0],
          to: [3.15, -0.02, -0.18],
          color: '#8B5CF6',
          anim: { pulseFlow: true }
        },
        {
          id: 'lbl-laser',
          type: 'label3d',
          pos: [-2.8, 0.92, 0],
          text: 'He-Ne Laser (632 nm)',
          color: '#EF4444',
          fontSize: 11
        },
        {
          id: 'lbl-lens',
          type: 'label3d',
          pos: [-0.45, 1.25, 0],
          text: 'Biconvex Lens (f)',
          color: '#0284C7',
          fontSize: 11
        },
        {
          id: 'lbl-prism',
          type: 'label3d',
          pos: [1.35, 1.25, 0],
          text: 'Dispersion Prism',
          color: '#7C3AED',
          fontSize: 11
        }
      ]
    }
  }

  if (cleanId === 'mechanics_rig' || cleanId === 'mechanics' || cleanId === 'pendulum' || cleanId === 'physics') {
    return {
      title: '3D Mechanics Rig (Spring + Ramp + Pendulum)',
      preset: 'mechanics_rig',
      immersed: true,
      showAxes: true,
      showGrid: true,
      animate: true,
      camera: { yaw: 42, pitch: 22, zoom: 1.0, autoRotate: false },
      elements: [
        // Lab table base
        {
          id: 'base',
          type: 'box',
          pos: [0, -0.82, 0],
          size: [6.4, 0.2, 3.2],
          color: '#334155'
        },
        // Inclined plane wedge
        {
          id: 'ramp',
          type: 'box',
          pos: [-1.05, -0.16, 0],
          rot: [0, 0, -24],
          size: [3.2, 0.16, 1.2],
          color: '#64748B'
        },
        // Ramp support pillar
        {
          id: 'ramp-support',
          type: 'box',
          pos: [-2.35, -0.12, 0],
          size: [0.22, 1.2, 1.2],
          color: '#475569'
        },
        // Sliding Mass Block
        {
          id: 'mass-block',
          type: 'box',
          pos: [-0.85, 0.22, 0],
          rot: [0, 0, -24],
          size: [0.68, 0.5, 0.68],
          color: '#2563EB',
          anim: { oscillate: { axis: 'x', amp: 0.18, freq: 2.2 } }
        },
        // Helical Spring anchored from top stop to mass block
        {
          id: 'spring',
          type: 'spring',
          from: [-2.22, 0.65, 0],
          to: [-1.15, 0.22, 0],
          radius: 0.16,
          tubeRadius: 0.035,
          turns: 8,
          color: '#F59E0B'
        },
        // Force vectors on mass block
        {
          id: 'vec-mg',
          type: 'arrow3d',
          from: [-0.85, 0.22, 0],
          to: [-0.85, -0.88, 0],
          color: '#EF4444',
          label: 'mg'
        },
        {
          id: 'vec-normal',
          type: 'arrow3d',
          from: [-0.85, 0.22, 0],
          to: [-0.45, 1.15, 0],
          color: '#10B981',
          label: 'N'
        },
        // Pendulum Gantry Stand on Right
        {
          id: 'gantry-post',
          type: 'cylinder',
          pos: [2.25, 0.45, -0.6],
          radius: 0.07,
          height: 2.35,
          color: '#475569'
        },
        {
          id: 'gantry-arm',
          type: 'cylinder',
          pos: [1.85, 1.58, -0.3],
          rot: [90, 0, 0],
          radius: 0.055,
          height: 1.0,
          color: '#475569'
        },
        {
          id: 'pendulum-rod',
          type: 'cylinder',
          pos: [1.85, 0.72, 0.1],
          radius: 0.028,
          height: 1.72,
          color: '#94A3B8'
        },
        {
          id: 'pendulum-bob',
          type: 'sphere',
          pos: [1.85, -0.14, 0.1],
          radius: 0.26,
          color: '#8B5CF6',
          anim: { oscillate: { axis: 'z', amp: 0.45, freq: 2.1 } }
        },
        {
          id: 'lbl-spring',
          type: 'label3d',
          pos: [-1.7, 0.95, 0],
          text: 'F_s = -kΔx',
          color: '#D97706',
          fontSize: 11
        },
        {
          id: 'lbl-pendulum',
          type: 'label3d',
          pos: [1.85, 1.82, 0],
          text: 'T = 2π√(L/g)',
          color: '#7C3AED',
          fontSize: 11
        }
      ]
    }
  }

  if (cleanId === 'chemistry_setup' || cleanId === 'chemistry' || cleanId === 'titration') {
    return {
      title: '3D Titration & Reaction Apparatus',
      preset: 'chemistry_setup',
      immersed: true,
      showAxes: false,
      showGrid: true,
      animate: true,
      camera: { yaw: 32, pitch: 20, zoom: 1.08, autoRotate: false },
      elements: [
        // Retort stand base
        {
          id: 'stand-base',
          type: 'box',
          pos: [-0.35, -0.82, 0],
          size: [2.5, 0.14, 1.6],
          color: '#1E293B'
        },
        // Vertical steel rod
        {
          id: 'stand-rod',
          type: 'cylinder',
          pos: [-1.15, 0.48, -0.25],
          radius: 0.06,
          height: 2.6,
          color: '#64748B'
        },
        // Clamp arm
        {
          id: 'clamp-arm',
          type: 'cylinder',
          pos: [-0.55, 1.28, -0.1],
          rot: [0, 0, 90],
          radius: 0.045,
          height: 1.25,
          color: '#94A3B8'
        },
        // Vertical graduated burette (translucent glass)
        {
          id: 'burette-tube',
          type: 'cylinder',
          pos: [0.05, 1.05, 0],
          radius: 0.11,
          height: 1.75,
          color: '#BAE6FD',
          opacity: 0.46
        },
        // Titrant liquid inside burette
        {
          id: 'burette-liquid',
          type: 'cylinder',
          pos: [0.05, 0.82, 0],
          radius: 0.085,
          height: 1.15,
          color: '#38BDF8',
          opacity: 0.72
        },
        // Stopcock valve
        {
          id: 'stopcock',
          type: 'box',
          pos: [0.05, 0.22, 0],
          size: [0.34, 0.1, 0.12],
          color: '#EF4444'
        },
        // Magnetic Stirrer Plate
        {
          id: 'stirrer-plate',
          type: 'box',
          pos: [0.05, -0.66, 0],
          size: [1.35, 0.18, 1.25],
          color: '#E2E8F0'
        },
        // Erlenmeyer Flask with glowing indicator reaction
        {
          id: 'flask',
          type: 'flask',
          pos: [0.05, -0.57, 0],
          radius: 0.56,
          height: 1.08,
          fillLevel: 0.46,
          color: '#E0F2FE',
          liquidColor: '#EC4899',
          opacity: 0.42
        },
        // Falling titrant droplet
        {
          id: 'droplet',
          type: 'sphere',
          pos: [0.05, 0.0, 0],
          radius: 0.055,
          color: '#38BDF8',
          emissive: true,
          anim: { oscillate: { axis: 'y', amp: 0.18, freq: 3.4 } }
        },
        // Secondary Reagent Beaker
        {
          id: 'beaker',
          type: 'cylinder',
          pos: [1.55, -0.42, 0.15],
          radius: 0.34,
          height: 0.68,
          color: '#BAE6FD',
          opacity: 0.45
        },
        {
          id: 'beaker-liquid',
          type: 'cylinder',
          pos: [1.55, -0.54, 0.15],
          radius: 0.3,
          height: 0.38,
          color: '#10B981',
          opacity: 0.68
        },
        {
          id: 'lbl-burette',
          type: 'label3d',
          pos: [0.75, 1.38, 0],
          text: '0.1 M NaOH Titrant',
          color: '#0284C7',
          fontSize: 11
        },
        {
          id: 'lbl-flask',
          type: 'label3d',
          pos: [0.95, -0.1, 0],
          text: 'HCl + Phenolphthalein',
          color: '#DB2777',
          fontSize: 11
        }
      ]
    }
  }

  if (cleanId === 'electromagnetism' || cleanId === 'solenoid' || cleanId === 'em') {
    const buildFieldLoop = (id: string, zOffset: number, yScale: number): Scene3DElement => {
      const pts: Vec3[] = []
      const steps = 28
      for (let i = 0; i <= steps; i++) {
        const theta = (i / steps) * Math.PI * 2
        pts.push([Math.cos(theta) * 2.5, Math.sin(theta) * yScale, zOffset])
      }
      return {
        id,
        type: 'curve3d',
        points: pts,
        color: '#38BDF8',
        anim: { pulseFlow: true }
      }
    }

    return {
      title: '3D Solenoid Coil & Magnetic Flux Field',
      preset: 'electromagnetism',
      immersed: true,
      showAxes: true,
      showGrid: true,
      animate: true,
      camera: { yaw: 34, pitch: 24, zoom: 1.0, autoRotate: false },
      elements: [
        // Ferromagnetic core cylinder
        {
          id: 'core',
          type: 'cylinder',
          pos: [0, 0, 0],
          rot: [0, 0, 90],
          radius: 0.36,
          height: 2.9,
          color: '#64748B',
          opacity: 0.72
        },
        // Helical Copper Solenoid Coil
        {
          id: 'coil',
          type: 'spring',
          from: [-1.35, 0, 0],
          to: [1.35, 0, 0],
          radius: 0.62,
          tubeRadius: 0.065,
          turns: 11,
          color: '#D97706'
        },
        // Axis magnetic field B vector
        {
          id: 'b-axis',
          type: 'arrow3d',
          from: [-2.4, 0, 0],
          to: [2.5, 0, 0],
          color: '#0EA5E9',
          label: 'B = μ₀nI',
          anim: { pulseFlow: true }
        },
        buildFieldLoop('flux-top', 0, 1.35),
        buildFieldLoop('flux-side', 0.65, 0.95),
        buildFieldLoop('flux-side-2', -0.65, 0.95),
        {
          id: 'lbl-b',
          type: 'label3d',
          pos: [2.65, 0.25, 0],
          text: 'B = μ₀ n I',
          color: '#0284C7',
          fontSize: 12
        },
        {
          id: 'lbl-n',
          type: 'label3d',
          pos: [1.6, 0.85, 0],
          text: 'N Pole',
          color: '#EF4444',
          fontSize: 12
        },
        {
          id: 'lbl-s',
          type: 'label3d',
          pos: [-1.6, 0.85, 0],
          text: 'S Pole',
          color: '#2563EB',
          fontSize: 12
        }
      ]
    }
  }

  // Default / 'surface_wave'
  return {
    title: '3D Wave Interference Surface z = f(x, y, t)',
    preset: 'surface_wave',
    immersed: true,
    showAxes: true,
    showGrid: true,
    animate: true,
    camera: { yaw: 40, pitch: 28, zoom: 1.0, autoRotate: false },
    elements: [
      {
        id: 'wave-surface',
        type: 'surface3d',
        expr: 'sin(sqrt(x*x + y*y)*2.1 - t*2.4) * exp(-0.12*(x*x + y*y)) * 1.15',
        xRange: [-3, 3],
        zRange: [-3, 3],
        resolution: 22,
        colorMap: 'coolwarm',
        color: '#2563EB',
        opacity: 0.92
      },
      {
        id: 'lbl-eq',
        type: 'label3d',
        pos: [0, 1.65, 0],
        text: 'z = sin(2.1r - 2.4t) · e^(-0.12r²)',
        color: '#7C3AED',
        fontSize: 12
      }
    ]
  }
}

function parseLooseNumberArray(raw: string): Vec3 | null {
  const nums = raw
    .replace(/[[\]()]/g, '')
    .split(/[\s,]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n))
  if (nums.length >= 3) return [nums[0], nums[1], nums[2]]
  return null
}

function parseKeyValue3DBlock(rawText: string): Scene3DSpec | null {
  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'))

  if (lines.length === 0) return null
  // Direct single-word preset name like `car` or `optics_bench`
  if (lines.length === 1 && !lines[0].includes(':') && !lines[0].startsWith('{')) {
    const word = lines[0].toLowerCase().replace(/[\s-]+/g, '_')
    if (
      word === 'car' ||
      word === 'vehicle' ||
      word === 'optics_bench' ||
      word === 'optics' ||
      word === 'mechanics_rig' ||
      word === 'mechanics' ||
      word === 'chemistry_setup' ||
      word === 'chemistry' ||
      word === 'electromagnetism' ||
      word === 'solenoid' ||
      word === 'surface_wave'
    ) {
      return buildPresetScene3D(word)
    }
  }

  let preset: string | undefined
  let title: string | undefined
  let expr: string | undefined
  let pos: Vec3 | undefined
  for (const line of lines) {
    const colon = line.indexOf(':')
    if (colon <= 0) continue
    const k = line.slice(0, colon).trim().toLowerCase()
    const v = line.slice(colon + 1).trim()
    if (k === 'preset') preset = v
    else if (k === 'title') title = v.replace(/^["']|["']$/g, '')
    else if (k === 'surface' || k === 'expr' || k === 'z') expr = v.replace(/^["']|["']$/g, '')
    else if (k === 'pos') pos = parseLooseNumberArray(v) ?? undefined
  }

  if (preset) {
    const base = buildPresetScene3D(preset)
    if (title) base.title = title
    return base
  }
  if (expr) {
    return {
      title: title || `3D Surface: ${expr}`,
      preset: 'surface_wave',
      immersed: true,
      showAxes: true,
      showGrid: true,
      animate: true,
      camera: { yaw: 40, pitch: 28, zoom: 1.0 },
      elements: [
        {
          id: 'surface-1',
          type: 'surface3d',
          expr,
          pos,
          xRange: [-3, 3],
          zRange: [-3, 3],
          resolution: 22,
          colorMap: 'viridis'
        }
      ]
    }
  }
  return null
}

/**
 * Normalizes any partial/shorthand/preset/LLM 3D payload into a complete valid `Scene3DSpec`.
 */
export function normalizeScene3DInput(raw: unknown): Scene3DSpec {
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        return normalizeScene3DInput(JSON.parse(trimmed))
      } catch {
        // fall through to key-value parser
      }
    }
    const kv = parseKeyValue3DBlock(trimmed)
    if (kv) return kv
    return buildPresetScene3D(trimmed || 'car')
  }

  if (Array.isArray(raw)) {
    const parsed = Scene3DSpecSchema.safeParse({
      title: '3D Object',
      preset: 'custom',
      immersed: true,
      showAxes: true,
      showGrid: true,
      animate: true,
      elements: raw
    })
    if (parsed.success) return parsed.data
    return buildPresetScene3D('car')
  }

  if (raw && typeof raw === 'object') {
    const obj = raw as Record<string, unknown>
    const presetVal = typeof obj.preset === 'string' ? obj.preset : undefined
    const rawElements = Array.isArray(obj.elements)
      ? obj.elements
      : Array.isArray(obj.objects)
        ? obj.objects
        : undefined

    // If a non-custom preset is specified without custom elements (or with partial overrides), merge them!
    let baseSpec: Scene3DSpec =
      presetVal && presetVal !== 'custom'
        ? buildPresetScene3D(presetVal)
        : {
            title: typeof obj.title === 'string' ? obj.title : '3D Object',
            preset: 'custom',
            immersed: true,
            showAxes: true,
            showGrid: true,
            animate: true,
            camera: { yaw: 38, pitch: 24, zoom: 1 },
            elements: []
          }

    // If shorthand `expr` or `surface` is on the root object
    if ((!rawElements || rawElements.length === 0) && (typeof obj.expr === 'string' || typeof obj.surface === 'string')) {
      const exprStr = String(obj.expr ?? obj.surface)
      baseSpec = {
        ...baseSpec,
        title: typeof obj.title === 'string' ? obj.title : `3D Surface: ${exprStr}`,
        elements: [
          {
            id: 'surface-1',
            type: 'surface3d',
            expr: exprStr,
            xRange: [-3, 3],
            zRange: [-3, 3],
            resolution: 22,
            colorMap: 'coolwarm'
          }
        ]
      }
    }

    const sanitizedElements: Scene3DElement[] = rawElements
      ? rawElements
          .map((item, idx): Scene3DElement | null => {
            if (!item || typeof item !== 'object') return null
            const el = { ...(item as Record<string, unknown>) }
            if (typeof el.id !== 'string' || !el.id.trim()) el.id = `el-${idx + 1}`
            // Alias common LLM names
            if (typeof el.kind === 'string' && !el.type) el.type = el.kind
            if (typeof el.position !== 'undefined' && !el.pos) el.pos = el.position
            if (typeof el.rotation !== 'undefined' && !el.rot) el.rot = el.rotation
            if (typeof el.type === 'string') {
              const t = el.type.toLowerCase().trim()
              if (t === 'cube' || t === 'cuboid') el.type = 'box'
              else if (t === 'ball') el.type = 'sphere'
              else if (t === 'tube' || t === 'rod' || t === 'pillar') el.type = 'cylinder'
              else if (t === 'arrow' || t === 'vector') el.type = 'arrow3d'
              else if (t === 'curve' || t === 'line3d' || t === 'ray' || t === 'path') el.type = 'curve3d'
              else if (t === 'surface' || t === 'plot3d') el.type = 'surface3d'
              else if (t === 'beaker') el.type = 'flask'
              else if (t === 'label' || t === 'text') el.type = 'label3d'
            }
            const valid = Scene3DElementSchema.safeParse(el)
            return valid.success ? valid.data : null
          })
          .filter((x): x is Scene3DElement => x !== null)
      : []

    const mergedElements =
      presetVal && presetVal !== 'custom' && sanitizedElements.length > 0
        ? [
            ...baseSpec.elements.filter((b) => !sanitizedElements.some((s) => s.id === b.id)),
            ...sanitizedElements
          ]
        : sanitizedElements.length > 0
          ? sanitizedElements
          : baseSpec.elements

    const candidate: Scene3DSpec = {
      ...baseSpec,
      title: typeof obj.title === 'string' ? obj.title : baseSpec.title,
      preset: Scene3DPresetIdSchema.safeParse(presetVal).success
        ? (presetVal as Scene3DPresetId)
        : baseSpec.preset,
      immersed: typeof obj.immersed === 'boolean' ? obj.immersed : (baseSpec.immersed ?? true),
      showAxes: typeof obj.showAxes === 'boolean' ? obj.showAxes : (baseSpec.showAxes ?? true),
      showGrid: typeof obj.showGrid === 'boolean' ? obj.showGrid : (baseSpec.showGrid ?? true),
      animate: typeof obj.animate === 'boolean' ? obj.animate : (baseSpec.animate ?? true),
      wireframe: typeof obj.wireframe === 'boolean' ? obj.wireframe : (baseSpec.wireframe ?? false),
      camera:
        obj.camera && typeof obj.camera === 'object'
          ? { ...(baseSpec.camera ?? {}), ...(obj.camera as Partial<Scene3DCamera>) }
          : baseSpec.camera,
      elements: mergedElements
    }

    const validated = Scene3DSpecSchema.safeParse(candidate)
    if (validated.success) return validated.data
  }

  return buildPresetScene3D('car')
}
