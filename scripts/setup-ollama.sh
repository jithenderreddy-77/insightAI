#!/bin/bash
# scripts/setup-ollama.sh
# Installs Ollama and pulls the Phi-3-mini model for local LLM inference.
# Used by the intent router, form-field mapper, and element resolver as a fallback.

set -e

echo "╔═══════════════════════════════════════════════════════════════╗"
echo "║  Insight AI — Ollama + Phi-3-mini Setup                      ║"
echo "╚═══════════════════════════════════════════════════════════════╝"
echo ""

# Check if Ollama is already installed
if command -v ollama &> /dev/null; then
    echo "✅ Ollama is already installed: $(ollama --version 2>/dev/null || echo 'version unknown')"
else
    echo "📦 Installing Ollama..."
    
    # Detect OS
    OS="$(uname -s)"
    case "$OS" in
        Darwin)
            echo "  → macOS detected"
            if command -v brew &> /dev/null; then
                brew install ollama
            else
                curl -fsSL https://ollama.com/install.sh | sh
            fi
            ;;
        Linux)
            echo "  → Linux detected"
            curl -fsSL https://ollama.com/install.sh | sh
            ;;
        *)
            echo "❌ Unsupported OS: $OS"
            echo "   Please install Ollama manually from: https://ollama.com"
            exit 1
            ;;
    esac
    
    echo "✅ Ollama installed"
fi

echo ""

# Start Ollama server if not running
if ! curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
    echo "🚀 Starting Ollama server..."
    ollama serve &
    OLLAMA_PID=$!
    sleep 3
    
    if curl -s http://localhost:11434/api/tags > /dev/null 2>&1; then
        echo "✅ Ollama server started (PID: $OLLAMA_PID)"
    else
        echo "❌ Failed to start Ollama server"
        exit 1
    fi
else
    echo "✅ Ollama server is already running"
fi

echo ""

# Pull Phi-3-mini model (~2.3GB)
echo "📥 Pulling phi3:mini model (~2.3GB)..."
echo "   This may take a few minutes on first run."
ollama pull phi3:mini

echo ""

# Verify the model works
echo "🧪 Verifying model with a test prompt..."
RESPONSE=$(curl -s http://localhost:11434/api/generate \
    -d '{"model":"phi3:mini","prompt":"Respond with only: OK","stream":false,"options":{"num_predict":5}}' \
    2>/dev/null | grep -o '"response":"[^"]*"' | head -1)

if [ -n "$RESPONSE" ]; then
    echo "✅ Model verified: $RESPONSE"
else
    echo "⚠️  Model response was empty, but it may still work."
fi

echo ""
echo "════════════════════════════════════════════════════════════════"
echo "  Setup complete!"
echo "  Ollama API: http://localhost:11434"
echo "  Model: phi3:mini"
echo ""
echo "  To keep Ollama running in the background:"
echo "    ollama serve &"
echo ""
echo "  To test manually:"
echo "    curl http://localhost:11434/api/generate -d '{\"model\":\"phi3:mini\",\"prompt\":\"Hello\",\"stream\":false}'"
echo "════════════════════════════════════════════════════════════════"
