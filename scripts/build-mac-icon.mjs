import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin') {
  process.exit(0)
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceIcon = resolve(projectRoot, 'resources/claude-canvas-icon.png')
const buildDir = resolve(projectRoot, 'build/mac')
const iconsetDir = resolve(buildDir, 'icon.iconset')
const outputIcon = resolve(buildDir, 'icon.icns')

if (!existsSync(sourceIcon)) {
  throw new Error(`Source icon not found at ${sourceIcon}`)
}

rmSync(iconsetDir, { force: true, recursive: true })
mkdirSync(iconsetDir, { recursive: true })

const sizes = [16, 32, 128, 256, 512]

for (const size of sizes) {
  const standardOutput = resolve(iconsetDir, `icon_${size}x${size}.png`)
  const retinaOutput = resolve(iconsetDir, `icon_${size}x${size}@2x.png`)

  execFileSync('sips', ['-z', String(size), String(size), sourceIcon, '--out', standardOutput], {
    stdio: 'ignore'
  })
  execFileSync(
    'sips',
    ['-z', String(size * 2), String(size * 2), sourceIcon, '--out', retinaOutput],
    {
      stdio: 'ignore'
    }
  )
}

execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', outputIcon], {
  stdio: 'ignore'
})
