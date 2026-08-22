# ImageGen Asset Prompts

All final raster assets were generated with the built-in OpenAI ImageGen workflow, then cropped, normalized, resized, and exported locally as WebP. No generated image contains text, a logo, or a watermark.

## Shared product prompt

> Create one isolated [SUBJECT] as a transparent game UI sprite. Original polished 2D mobile game illustration, rounded dark-plum #35283f outline, soft cel and gouache shading, bright candy palette, clean readable silhouette, centered with consistent optical anchor, generous transparent padding, front three-quarter view where useful. No text, letters, numbers, logo, watermark, frame, hands, people, or background.

`[SUBJECT]` values: waffle cone, paper ice-cream cup, waffle bowl, vanilla scoop, chocolate scoop, strawberry scoop, mint scoop, pink-blue-white sprinkles, chocolate drizzle, lemonade, berry soda, finished bubble tea, empty sealed tea cup, milk tea in cup, tapioca pearls.

## Cinnamon Roll family

The built-in ImageGen workflow generated four separate transparent product sprites using the existing Vanilla scoop, Bubble Tea, Waffle Bowl, Chocolate scoop, and Strawberry scoop assets only as style and palette references.

> Create one plain baked cinnamon roll viewed at a slightly elevated front three-quarter angle, clearly showing the spiral; no icing yet. Polished original 2D game illustration, dark-plum outline, soft cel/gouache shading, warm golden pastry and cinnamon-brown spiral, one centered object with even transparent padding, readable at 64 px. No plate, packaging, crumbs, text, logo, brand, watermark, people, scenery, checkerboard, or clipping.

> Create the same cinnamon-roll silhouette and angle with a generous smooth vanilla cream-cheese glaze flowing across the upper spiral with a few rounded drips. Preserve the optical center, outline, canvas, and lighting. Warm ivory glaze with pale golden highlights. Real alpha transparency; no background, plate, packaging, text, logo, brand, watermark, people, or clipping.

> Create the same cinnamon-roll silhouette and angle with glossy dark chocolate icing across the upper spiral and a few rounded drips. Preserve the optical center, outline, canvas, and lighting. Rich cocoa glaze with warm highlights. Real alpha transparency; no background, plate, packaging, text, logo, brand, watermark, people, or clipping.

> Create the same cinnamon-roll silhouette and angle with glossy berry-pink icing across the upper spiral, a few rounded drips, and tiny natural berry-colored flecks. Preserve the optical center, outline, canvas, and lighting. Real alpha transparency; no background, plate, packaging, text, logo, brand, watermark, people, or clipping.

The accepted outputs were alpha-cleaned where the generator rendered a checkerboard matte, normalized to 256×256 WebP with 18 px transparent padding, and verified against a solid black background. Runtime names are `cinnamon-roll.webp`, `cinnamon-roll-vanilla.webp`, `cinnamon-roll-chocolate.webp`, and `cinnamon-roll-berry.webp`.

## Shared equipment prompt

> Create one isolated [SUBJECT] equipment upgrade icon on a transparent background for a polished 2D time-management game. Rounded dark-plum outline, soft cel/gouache shading, candy palette, compact centered silhouette that reads at 48 px, generous transparent padding. No text, logo, watermark, frame, people, or scene.

`[SUBJECT]` values: better freezer, expanded service counter, automatic ice-cream base station, deluxe three-customer counter.

The clarity pass used the following functional subjects: a glass-lid freezer with a large snowflake; a counter with exactly two separate serving bays; an automatic cone dispenser with a visible nozzle and conveyor; and a counter with exactly three separate serving bays. The three accepted redraws were normalized to 256×256 WebP. Existing mood sprites were not regenerated: their matching happy-state alpha masks were reapplied so identity, expression, outfit, and pose stayed pixel-aligned while the baked checkerboard disappeared.

## Character base prompt

> Create an original front-facing waist-up ice-cream-parlor customer on a transparent background. Polished 2D mobile game illustration, oversized rounded head, expressive face, rounded dark-plum outline, soft cel/gouache shading, candy-colored clothing, clean silhouette, centered 384×384 composition. [IDENTITY AND ROLE]. Happy and patient expression. No text, logo, watermark, food, UI, frame, or background.

The identity set contains four regular customers, two friendly Patient VIPs with gold accents, and two exacting Critic VIPs with distinct outfits and warning-ready silhouettes.

## Identity-preserving mood edit prompt

> Edit this exact character into the [WORRIED / ANGRY / URGENT] patience state. Preserve identity, skin tone, hairstyle, clothing, pose, proportions, framing, outline, lighting, palette, and transparent background exactly. Change only the facial expression and small natural facial cues. No aura, text, logo, watermark, extra props, or background.

The urgent variants use the strongest dissatisfied expression; the red aura and pulse are applied by CSS at runtime.

## Landscape scene prompt

> Original cheerful ice-cream parlor interior for a polished 2D time-management game, wide landscape composition. Pink-and-cream striped awning, mint wall, warm cream-and-gold service counter, plum architectural outline, candy palette, soft cel/gouache shading, symmetric lamps and framing, broad quiet empty center for gameplay readability. No people, products, text, UI, logo, or watermark.

## Portrait scene prompt

> Create a portrait counterpart to the supplied landscape ice-cream parlor. Preserve the same architecture, awning, mint wall, counter, plum outline, candy palette, lighting, brush treatment, and quiet gameplay center. Recompose naturally for a tall mobile screen. No people, products, text, UI, logo, or watermark.

## Submission thumbnail composition

The text-free 1:1, 5:7, and 16:9 thumbnails are deterministic local composites of the generated scene, two happy character sprites, and a three-scoop product stack. Their source composition is `scripts/generate-thumbnails.mjs`.

## Milk Tea clarity redraw

The Milk Tea recipe step was redrawn as the same clear takeaway cup used by Tea Cup and Bubble Tea, filled with creamy caramel milk tea but containing no tapioca pearls, straw, handle, or pitcher. The built-in ImageGen edit used the previous pitcher as the edit target, the empty cup as the silhouette reference, and the finished Bubble Tea as the rendering reference. A second background-extraction edit preserved the cup and removed the generated checkerboard to a real alpha channel. The accepted result was normalized to a centered 256×256 transparent WebP.
