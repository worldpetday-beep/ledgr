import { useEffect, useState } from 'react'
import { BoxesIcon } from './icons'

export function ItemThumb({ image, size = 32, className = '' }: { image?: Blob; size?: number; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!image) {
      setUrl(null)
      return
    }
    const objectUrl = URL.createObjectURL(image)
    setUrl(objectUrl)
    return () => URL.revokeObjectURL(objectUrl)
  }, [image])

  const style = { width: size, height: size }

  if (!url) {
    return (
      <div
        style={style}
        className={`flex shrink-0 items-center justify-center rounded-md bg-[var(--page-plane)] text-[var(--text-muted)] ${className}`}
      >
        <BoxesIcon className="h-1/2 w-1/2" />
      </div>
    )
  }

  return (
    <img
      src={url}
      style={style}
      className={`shrink-0 rounded-md object-cover ${className}`}
      alt=""
    />
  )
}
