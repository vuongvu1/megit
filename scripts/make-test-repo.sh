#!/usr/bin/env bash
# Regenerates test-repo/ — a git-ignored fixture repo for manually exercising
# megit (parallel branches, merge, stash, dirty WIP). Safe to delete and re-run.
set -euo pipefail

cd "$(dirname "$0")/.."
rm -rf test-repo
mkdir test-repo
cd test-repo

git init -q -b main
git config user.name "Test User"
git config user.email "test@example.com"

commit() { # commit <msg> <date-offset-minutes>
  GIT_AUTHOR_DATE="2026-01-01T10:$2:00" GIT_COMMITTER_DATE="2026-01-01T10:$2:00" \
    git commit -q -m "$1"
}

echo "hello" > readme.md
git add . && commit "initial commit" 00

echo "one" > a.txt
git add . && commit "add a.txt" 05

git checkout -qb feature/login
echo "login" > login.ts
git add . && commit "add login" 10
echo "logout" >> login.ts
git add . && commit "add logout" 15

git checkout -q main
echo "two" >> a.txt
git add . && commit "update a.txt" 12

git merge -q --no-ff feature/login -m "merge feature/login"

git checkout -qb feature/search
echo "search" > search.ts
git add . && commit "add search (unmerged)" 25
git checkout -q main

echo "stashed work" > stashme.txt
git add stashme.txt
git stash push -q -m "wip: stashed work"

echo "dirty" >> readme.md   # uncommitted WIP

echo "test-repo ready: $(git log --oneline | wc -l | tr -d ' ') commits, 1 stash, dirty worktree"
