import type { StatusEntry } from '../server/parse.ts'

// dir iff children present; single-child dir chains compress into one node ("a/b/c")
export type TreeNode = { name: string; path: string; status?: string; children?: TreeNode[] }

type Dir = { dirs: Map<string, Dir>; files: { name: string; status: string }[] }

export function buildTree(files: StatusEntry[]): TreeNode[] {
  const root: Dir = { dirs: new Map(), files: [] }
  for (const f of files) {
    const parts = f.path.split('/')
    let d = root
    for (const seg of parts.slice(0, -1)) {
      let next = d.dirs.get(seg)
      if (!next) {
        next = { dirs: new Map(), files: [] }
        d.dirs.set(seg, next)
      }
      d = next
    }
    d.files.push({ name: parts[parts.length - 1], status: f.status })
  }

  const emit = (d: Dir, prefix: string): TreeNode[] => {
    const out: TreeNode[] = []
    for (const [dirName, sub] of [...d.dirs].sort((a, b) => a[0].localeCompare(b[0]))) {
      let name = dirName
      let node = sub
      while (node.dirs.size === 1 && node.files.length === 0) {
        const [childName, child] = node.dirs.entries().next().value!
        name += '/' + childName
        node = child
      }
      const path = prefix + name
      out.push({ name, path, children: emit(node, path + '/') })
    }
    for (const f of [...d.files].sort((a, b) => a.name.localeCompare(b.name)))
      out.push({ name: f.name, path: prefix + f.name, status: f.status })
    return out
  }
  return emit(root, '')
}
