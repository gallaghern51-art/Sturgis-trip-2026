# Shield overrides

**Do not delete this folder.** Anything in here wins over the downloaded shield.

Shields normally come from Wikimedia Commons through
`netlify/functions/shield.mjs`, which already returns the real state designs —
Wyoming's bucking horse, South Dakota's state outline, Idaho's silhouette,
Montana's square. Nothing needs to be put here for those to work.

This folder is for the cases where Commons is wrong, missing, or has a worse
drawing than one you have. Drop a file in and that route uses it instead, with
no code change:

    public/shields/WY-14.svg      ->  used for WY-14
    public/shields/US-14A.svg     ->  used for US-14A

The filename **is** the route key: `<PREFIX>-<NUMBER>.svg`, matching the label
the app shows. `.svg` is preferred; `.png` and `.webp` also work.

There is deliberately no list of routes anywhere in the source — adding a file
here is the entire step.
