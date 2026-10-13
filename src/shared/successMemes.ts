// Same order and rolling hash as the tablet's success_memes.dart.
// This ID is shared by both devices through the existing gift flow.
export const successMemeIds = [
  'crocodile',
  'howling-cat',
  'happy-kitten',
  'strong-kitten',
  'cool-dog'
] as const
export type SuccessMemeId = (typeof successMemeIds)[number]

export function successMemeFor(giftId: string): SuccessMemeId {
  let hash = 0
  for (let index = 0; index < giftId.length; index++) {
    hash = (Math.imul(hash, 31) + giftId.charCodeAt(index)) & 0x7fffffff
  }
  return successMemeIds[hash % successMemeIds.length]
}
