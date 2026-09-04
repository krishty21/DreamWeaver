import { PrismaClient } from '@prisma/client'

// Bump this whenever the Prisma schema changes during development.
// The running dev server keeps a singleton client in globalThis; without this
// check a stale client (missing new columns) would keep serving old queries.
const SCHEMA_VERSION = 'v2-share-fields'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  prismaSchemaVersion: string | undefined
}

if (globalForPrisma.prismaSchemaVersion !== SCHEMA_VERSION) {
  if (globalForPrisma.prisma) {
    void globalForPrisma.prisma.$disconnect().catch(() => {})
  }
  globalForPrisma.prisma = undefined
  globalForPrisma.prismaSchemaVersion = SCHEMA_VERSION
}

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: ['query'],
  })

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
