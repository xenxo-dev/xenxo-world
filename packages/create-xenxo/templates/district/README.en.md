# {{title}} — a xenxo district

A community district for [xenxo.io](https://xenxo.io): 256 × 256 m of the world, described in
`xenxo-district.json` with the models in this folder.

```bash
npm install
npm run validate        # checks the district the way xenxo will
```

Then upload it from **xenxo.io → Account → Your district → Upload folder**: it stays as a draft (only
you can see it), you try it and send it for review. All the rules and sizes: **AGENTS.md** (for your
AI too). Put your name and contact in `author` and `contact`.

## If `npm install` fails with a 404 on `@xenxo/district-kit`

It isn't on npm yet. Until it is, take it from the repository
([xenxo-dev/xenxo-world](https://github.com/xenxo-dev/xenxo-world)):

```bash
# once, in another folder:
git clone https://github.com/xenxo-dev/xenxo-world && cd xenxo-world && npm install
mkdir -p ~/xenxo-packages && npm pack -w @xenxo/district-kit --pack-destination ~/xenxo-packages
# in the district folder:
npm install -D ~/xenxo-packages/xenxo-district-kit-*.tgz
```

MIT.
