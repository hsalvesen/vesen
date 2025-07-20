# [Vesen Terminal](https://www.vesen.app)

> A modern web-based terminal emulator built with SVELTE.

![banner](/docs/themes/banner.gif)
## Overview

Vesen Terminal is a fully-featured web-based terminal emulator that replicates a Unix-like environment in your browser. It features a virtual file system, interactive commands, modifiable themes, and a responsive design that works across devices.


## Stack

- **Frontend framework**: [Svelte 5](https://svelte.dev/)
- **Build tool**: [Vite](https://vitejs.dev/)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Containerisation**: [Docker](https://docker.com/)
- **Package manager**: npm (Node.js 18.17.0+)

## Quick start

### Using Docker (Recommended)

```bash
# Run the latest version
docker run -d --name vesen-terminal -p 3000:3000 ghcr.io/hsavlesen/vesen

# Or use docker-compose
docker-compose up -d
```

Access the terminal at `http://localhost:3000`

### Local development

**Prerequisites**: Node.js 18.17.0 or higher

```bash
# Clone the repository
git clone https://github.com/hsalvesen/vesen.git
cd vesen

# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build

# Preview production build
npm run preview
```

### Getting started
Type `help` in the terminal to see all available commands, or explore the file system with `ls` and `cd`.

## Themes

![themes](/docs/themes/themes.gif)
View all themes: [Vesen themes](/docs/themes)

##  Docker deployment

### Using docker hub image
```bash
docker run -d \
  --name vesen-terminal \
  -p 3000:3000 \
  --restart unless-stopped \
  ghcr.io/hsavlesen/vesen
```

### Building from source
```bash
# Build the image
docker build -t vesen-terminal .

# Run the container
docker run -d -p 3000:3000 vesen-terminal
```

### Docker compose
```yaml
services:
  terminal:
    image: ghcr.io/hsavlesen/vesen
    container_name: vesen-terminal
    restart: unless-stopped
    ports:
      - "3000:3000"
```

##  Development

### Project structure
```src/
├── components/                # Svelte components
│   ├── History.svelte         # Command history display
│   ├── Input.svelte           # Command input handling
│   └── Ps1.svelte             # Terminal prompt
├── utils/
│   ├── commands/              # Command implementations
│   ├── virtualFileSystem.ts
│   └── commands.ts
├── stores/                    # Svelte stores
└── interfaces/                # TypeScript interfaces
```

### Available scripts
```bash
npm run dev      # Start development server
npm run build    # Build for production
npm run preview  # Preview production build
npm run check    # Run Svelte type checking
```

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues.

### Development setup
1. Fork the repository
2. Create a feature branch: `git checkout -b feature/new-feature`
3. Make your changes
4. Run tests: `npm run check`
5. Commit your changes: `git commit -m 'Add new feature'`
6. Push to the branch: `git push origin feature/new-feature`
7. Open a Pull Request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Author

**Has Salvesen**
- [Website](https://www.vesen.app)
- [Github](https://github.com/hsalvesen)
- [LinkedIn](https://www.linkedin.com/in/harrysalvesen/)

---