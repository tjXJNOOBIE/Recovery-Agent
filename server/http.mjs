#!/usr/bin/env node
import http from 'node:http'
import crypto from 'node:crypto'
import {spawn} from 'node:child_process'
import readline from 'node:readline'
import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {existsSync, readFileSync} from 'node:fs'

const root = path.dirname(fileURLToPath(import.meta.url))
const packageRoot = path.dirname(root)
const configPath = path.resolve(process.env.RECOVERY_HTTP_CONTROL_CONFIG || process.argv[2] || '')
const maxBodyBytes = 1_048_576
const version = '0.1.0'
const host = process.env.RECOVERY_HTTP_HOST || process.env.HOST || '0.0.0.0'
const port = Number(process.env.RECOVERY_HTTP_PORT || process.env.PORT || '7844')
const authToken = String(process.env.RECOVERY_HTTP_AUTH_TOKEN || '').trim()
const loopback = host === '127.0.0.1' || host === '::1' || host === 'localhost'

if (!configPath || !existsSync(configPath)) throw new Error('RECOVERY_HTTP_CONTROL_CONFIG must point to an existing control config file')
if (!loopback && authToken.length < 16) throw new Error('RECOVERY_HTTP_AUTH_TOKEN with at least 16 characters is required for non-loopback HTTP hosting')
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('RECOVERY_HTTP_PORT must be a valid TCP port')

let child
let childLines
let nextRequestId = 1
const pending = new Map()

function rejectChild(reason) {
  for (const waiter of pending.values()) waiter.reject(reason)
  pending.clear()
  childLines?.close()
  childLines = undefined
  child = undefined
}

function startChild() {
  child = spawn(process.execPath, [path.join(packageRoot, 'dist/cli/main.js'), 'mcp', configPath], {
    cwd: packageRoot,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  childLines = readline.createInterface({input: child.stdout, crlfDelay: Infinity})
  childLines.on('line', (line) => {
    let message
    try { message = JSON.parse(line) } catch { return }
    if (message?.id === undefined || message?.id === null) return
    const waiter = pending.get(message.id)
    if (!waiter) return
    pending.delete(message.id)
    waiter.resolve(message)
  })
  child.once('error', (error) => rejectChild(error instanceof Error ? error : new Error(String(error))))
  child.once('exit', (code) => rejectChild(new Error(`Recovery MCP worker exited with code ${code ?? 'unknown'}`)))
}

async function callChild(message) {
  if (!child || child.stdin.destroyed) startChild()
  const internalId = `http-${nextRequestId++}`
  const request = {...message, id: internalId}
  return await new Promise((resolve, reject) => {
    pending.set(internalId, {
      resolve: (response) => resolve({...response, id: message.id}),
      reject,
    })
    child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
      if (!error) return
      pending.delete(internalId)
      reject(error)
    })
  })
}

function applyCors(response) {
  response.setHeader('access-control-allow-origin', '*')
  response.setHeader('access-control-allow-headers', 'accept,content-type,authorization,mcp-protocol-version')
  response.setHeader('access-control-allow-methods', 'GET,POST,OPTIONS')
  response.setHeader('x-content-type-options', 'nosniff')
}

function json(response, status, value) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(value))
}

function authorized(request) {
  if (authToken.length === 0) return loopback
  const supplied = Buffer.from(String(request.headers.authorization || '').replace(/^Bearer\s+/, ''))
  const expected = Buffer.from(authToken)
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected)
}

async function readJson(request) {
  const encoding = String(request.headers['content-encoding'] || '').trim().toLowerCase()
  if (encoding && encoding !== 'identity') throw new Error('compressed request bodies are not supported')
  const declared = Number(request.headers['content-length'] || 0)
  if (Number.isFinite(declared) && declared > maxBodyBytes) throw new Error('request body is too large')
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > maxBodyBytes) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) } catch { throw new Error('request body must be valid JSON') }
}

async function handle(request, response) {
  applyCors(response)
  if (request.method === 'OPTIONS') { response.statusCode = 204; response.end(); return }
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`)
  if (url.pathname === '/healthz' || url.pathname === '/readyz') {
    json(response, 200, {status: 'ok', name: 'Recovery Agent', version, mcp: '/mcp', controlConfig: configPath})
    return
  }
  if (url.pathname !== '/mcp') { response.statusCode = 404; response.end('Not found'); return }
  if (request.method !== 'POST') { response.statusCode = 405; response.setHeader('allow', 'POST, OPTIONS'); response.end('Method not allowed'); return }
  if (!authorized(request)) {
    response.setHeader('www-authenticate', 'Bearer')
    json(response, 401, {error: 'authenticated MCP access is required'})
    return
  }
  try {
    json(response, 200, await callChild(await readJson(request)))
  } catch (error) {
    json(response, 400, {jsonrpc: '2.0', id: null, error: {code: -32600, message: error?.message || 'Invalid MCP request'}})
  }
}

const server = http.createServer((request, response) => { void handle(request, response) })
server.requestTimeout = 30_000
server.headersTimeout = 15_000
server.listen(port, host, () => process.stderr.write(`Recovery Agent HTTP listening on ${host}:${port}\n`))

async function close() {
  child?.kill('SIGTERM')
  childLines?.close()
  await new Promise((resolve) => server.close(() => resolve()))
}
process.once('SIGINT', () => { void close() })
process.once('SIGTERM', () => { void close() })
