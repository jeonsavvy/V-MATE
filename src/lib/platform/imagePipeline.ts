export interface ResizeVariant {
  kind: string
  width: number
  height: number
}

export interface ResizedImageAsset {
  kind: string
  width: number
  height: number
  dataUrl: string
  sourceWidth: number
  sourceHeight: number
}

const loadImage = (file: File): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(objectUrl)
      resolve(image)
    }
    image.onerror = (error) => {
      URL.revokeObjectURL(objectUrl)
      reject(error)
    }
    image.src = objectUrl
  })

const drawCover = ({ image, width, height }: { image: HTMLImageElement; width: number; height: number }) => {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) {
    throw new Error('이미지 캔버스를 초기화하지 못했습니다.')
  }

  const sourceRatio = image.width / image.height
  const targetRatio = width / height

  let sx = 0
  let sy = 0
  let sw = image.width
  let sh = image.height

  if (sourceRatio > targetRatio) {
    sw = image.height * targetRatio
    sx = (image.width - sw) / 2
  } else {
    sh = image.width / targetRatio
    sy = (image.height - sh) / 2
  }

  context.drawImage(image, sx, sy, sw, sh, 0, 0, width, height)
  return canvas
}

export const createImageVariants = async ({
  file,
  variants,
}: {
  file: File
  variants: ResizeVariant[]
}): Promise<ResizedImageAsset[]> => {
  const image = await loadImage(file)
  return variants.map((variant) => {
    const canvas = drawCover({ image, width: variant.width, height: variant.height })
    const dataUrl = canvas.toDataURL('image/webp', 0.86)
    return {
      kind: variant.kind,
      width: variant.width,
      height: variant.height,
      dataUrl,
      sourceWidth: image.width,
      sourceHeight: image.height,
    }
  })
}

export const CHARACTER_VARIANTS: ResizeVariant[] = [
  { kind: 'thumb', width: 300, height: 400 },
  { kind: 'card', width: 600, height: 800 },
  { kind: 'detail', width: 768, height: 1024 },
]

export const WORLD_VARIANTS: ResizeVariant[] = [
  { kind: 'thumb', width: 320, height: 180 },
  { kind: 'card', width: 640, height: 360 },
  { kind: 'hero', width: 1280, height: 720 },
]
