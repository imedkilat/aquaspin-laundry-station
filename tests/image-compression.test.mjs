import assert from 'node:assert/strict'
import test from 'node:test'
import {
  isAnimatedImage,
  isAnimatedPng,
  isAnimatedWebp,
} from '../src/lib/storage-images.ts'

const staticPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAIAAACRXR/mAAAAS0lEQVR4nO3OsQEAEADAMPz/Mw9YMjE0F2Tu8aP1OnBXS9QStUQtUUvUErVELVFL1BK1RS9QStUQtUUvUErVELVFL1BK1RC1xAEGqAWOFuDKrAAAAAElFTkSuQmCC',
  'base64',
)
const animatedPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAADIAAAAyCAIAAACRXR/mAAAACGFjVEwAAAACAAAAAPONk3AAAAAaZmNUTAAAAAAAAAAyAAAAMgAAAAAAAAAAAAEACgAAETUwzwAAAEtJREFUeJztzrEBABAAwDD8/zMPWDIxNBdk7vGj9TpwV0vUErVELVFL1BK1RC1RS9QStUQtUUvUErVELVFL1BK1RS9QStUQtcQBBqgFjhbgyqwAAABpmY1RMAAAAAQAAADIAAAAyAAAAAAAAAAAAAQAKAACKRtobAAAAT2ZkQVQAAAACeJztzrEBABAAwDD8/zMPWDoxJBdkjj0+tF4H7rQKrUKr0Cq0Cq1Cq9AqtAqtQqvQKrQKrUKr0Cq0Cq1Cq9AqtAqtQqvQKg5AqwFj0lXfNwAAAABJRU5ErkJggg==',
  'base64',
)
const staticWebp = Buffer.from(
  'UklGRlYAAABXRUJQVlA4IEoAAAAQBACdASoyADIAPm02mEkkIyKhIggAgA2JaQB2APwAACBupqAK8QtyAAD+8JtD//5BcsLrka///ID/kB/yA//j3xbjo8cQgAAAAA==',
  'base64',
)
const animatedWebp = Buffer.from(
  'UklGRgQBAABXRUJQVlA4WAoAAAACAAAAMQAAMQAAQU5JTQYAAAAAAAAAAABBTk1GagAAAAAAAAAAADEAADEAAGQAAAJWUDggUgAAALAEAJ0BKjIAMgA+bTaZSSQjIqEiCACADYlpBigAmQH4AAiBktlWJj2n15tXQAAA/vCbQ//+QXLC65Gv//yA/5Af8gP/5AflTZnMXkaKqgnwgABBTk1GZgAAAAAAAAAAADEAADEAAGQAAABWUDggTgAAADQEAJ0BKjIAMgA+bTKSSQIgAADYlpANWqgH4AfgACLt0ZQYR2nUfk1bsAD+5Yc//7WgODVf5n//+++FEduv9CX6YXsil/xM5+NS/wXAAA==',
  'base64',
)

test('isAnimatedPng returns false for a static PNG', () => {
  assert.equal(isAnimatedPng(staticPng), false)
})

test('isAnimatedPng returns true for an animated APNG', () => {
  assert.equal(isAnimatedPng(animatedPng), true)
})

test('isAnimatedWebp returns false for a static WebP', () => {
  assert.equal(isAnimatedWebp(staticWebp), false)
})

test('isAnimatedWebp returns true for an animated WebP', () => {
  assert.equal(isAnimatedWebp(animatedWebp), true)
})

test('isAnimatedImage returns false for a static PNG File', async () => {
  const file = new File([staticPng], 'static.png', { type: 'image/png' })
  assert.equal(await isAnimatedImage(file), false)
})

test('isAnimatedImage returns true for an animated WebP File', async () => {
  const file = new File([animatedWebp], 'animated.webp', { type: 'image/webp' })
  assert.equal(await isAnimatedImage(file), true)
})

test('isAnimatedImage returns false for a JPEG regardless of content', async () => {
  const file = new File([animatedWebp], 'content-is-webp.jpg', { type: 'image/jpeg' })
  assert.equal(await isAnimatedImage(file), false)
})
