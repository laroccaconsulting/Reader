#!/usr/bin/env node
/* Copies the files the app serves into dist/ for hosting (readfree.app). */
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const out = join(root, 'dist')
const files = ['index.html', 'manifest.json', 'sw.js', 'LICENSE', 'PRIVACY.md', 'app', 'styles', 'fonts', 'icons', 'vendor', 'data', 'books']
rmSync(out, { recursive: true, force: true })
mkdirSync(out)
for (const f of files) if (existsSync(join(root, f))) cpSync(join(root, f), join(out, f), { recursive: true })
cpSync(join(root, 'site/_headers'), join(out, '_headers'))
console.log(`dist/ ready (${files.length} entries)`)
