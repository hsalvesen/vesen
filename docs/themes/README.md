# Vesen Themes

### 1. Cassowary
- **Colors**: Dark theme with vibrant pink and cyan accents
- **Screenshot**: [cassowary.png](screenshots/cassowary.png)

### 2. Cockatoo
- **Colors**: Light theme with warm earth tones
- **Screenshot**: [cockatoo.png](screenshots/cockatoo.png)

### 3. Crocodile
- **Colors**: Dark theme with green and yellow highlights
- **Screenshot**: [crocodile.png](screenshots/crocodile.png)

### 4. Kangaroo
- **Colors**: Dark theme with orange and amber tones
- **Screenshot**: [kangaroo.png](screenshots/kangaroo.png)

### 5. Kookaburra
- **Colors**: Dark theme with blue and cyan accents
- **Screenshot**: [kookaburra.png](screenshots/kookaburra.png)

### 6. Pink Robin
- **Colors**: Dark theme with purple and pink highlights
- **Screenshot**: [pinkRobin.png](screenshots/pinkRobin.png)

### 7. Swamp Hen
- **Colors**: Dark theme with vibrant purple and cyan
- **Screenshot**: [swampHen.png](screenshots/swampHen.png)

### 8. Tree Frog
- **Colors**: Green background with yellow text
- **Screenshot**: [treeFrog.png](screenshots/treeFrog.png)

### 9. Wallaby
- **Colors**: Dark theme with soft pastels
- **Screenshot**: [wallaby.png](screenshots/wallaby.png)

### 10. Wombat
- **Colors**: Dark theme with warm gruvbox-inspired colors
- **Screenshot**: [wombat.png](screenshots/wombat.png)

## Screenshot Guidelines

When adding theme screenshots:

1. **Naming Convention**: Use the exact theme name from `themes.json` followed by `.png`
2. **Location**: Place all screenshots in the `screenshots/` folder
3. **Content**: Show the terminal with some sample commands to demonstrate the theme's colors
4. **Resolution**: Recommended minimum width of 800px for clarity
5. **Format**: PNG format for best quality

## Theme Structure

Each theme in `themes.json` contains the following color definitions:
- Standard colors: black, red, green, yellow, blue, purple, cyan, white
- Bright variants: brightBlack, brightRed, brightGreen, etc.
- Special colors: foreground, background, cursorColor

## Usage

Users can switch themes using the `theme` command in the terminal:
```bash
theme <theme-name>
```

For example:
```bash
theme cassowary
theme wombat
```