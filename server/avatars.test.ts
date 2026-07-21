import { describe, it, expect } from 'vitest'
import { noreplyAvatar, parseGithubRemote } from './avatars.ts'

describe('noreplyAvatar', () => {
  it('resolves id-form noreply emails', () => {
    expect(noreplyAvatar('12345+octo@users.noreply.github.com')).toBe('https://avatars.githubusercontent.com/u/12345?s=48')
  })
  it('resolves legacy noreply emails', () => {
    expect(noreplyAvatar('octo@users.noreply.github.com')).toBe('https://github.com/octo.png?size=48')
  })
  it('rejects other emails', () => {
    expect(noreplyAvatar('vu@example.com')).toBeNull()
    expect(noreplyAvatar('evil@users.noreply.github.com.evil.com')).toBeNull()
  })
})

describe('parseGithubRemote', () => {
  it('parses ssh and https forms', () => {
    expect(parseGithubRemote('git@github.com:owner/repo.git\n')).toEqual({ owner: 'owner', repo: 'repo' })
    expect(parseGithubRemote('https://github.com/owner/repo')).toEqual({ owner: 'owner', repo: 'repo' })
    expect(parseGithubRemote('https://github.com/owner/repo.git')).toEqual({ owner: 'owner', repo: 'repo' })
  })
  it('rejects non-github remotes', () => {
    expect(parseGithubRemote('git@gitlab.com:owner/repo.git')).toBeNull()
  })
})
