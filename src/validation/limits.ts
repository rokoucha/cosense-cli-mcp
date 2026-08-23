import { z } from 'zod'

/** Cosense内部IDは24文字の小文字16進数(ObjectId形式)。 */
export const objectIdSchema = z
  .string()
  .regex(/^[0-9a-f]{24}$/, 'must be a 24-char lowercase hex id')

export const pageIdSchema = objectIdSchema
export const commitIdSchema = objectIdSchema
export const lineIdSchema = objectIdSchema
export const snapshotIdSchema = objectIdSchema

/** previewEditのanchorは <lineId> または特殊値 "_end"。 */
export const insertBeforeAnchorSchema = z.union([
  objectIdSchema,
  z.literal('_end'),
])

/** previewId はCLIが発行する不透明token。文字種と長さだけを制約する。 */
export const previewIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/, 'previewId contains invalid characters')

export const searchQuerySchema = z.string().min(1).max(1000)

export const filterNameSchema = z.string().min(1).max(200)

export const listPagesSortSchema = z.enum([
  'updated',
  'created',
  'accessed',
  'linked',
  'views',
  'title',
])

export const fullTextSearchSortSchema = z.enum(['pageRank', 'updated'])

export function limitSchema(max: number) {
  return z.number().int().min(1).max(max)
}

export const skipSchema = z.number().int().min(0)

export function editTextSchema(maxLength: number) {
  return z.string().max(maxLength)
}
