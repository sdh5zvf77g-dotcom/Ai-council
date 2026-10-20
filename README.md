# Crazy Bob 🤪 — Autonomous Engine + Long-Term Memory & Offline RAG

Private local AI chat that runs entirely in your browser using WebLLM + WebGPU.  
No cloud required for chat. Works on iPhone (Safari 26+).

## New in this version

### 1. Long-Term Memory Compression (Episodic Summarization)
When chat history exceeds ~400 messages, Bob automatically compresses the oldest turns into a permanent **User Profile**.  
Key facts about your life, preferences, projects and goals are kept forever and injected into every future conversation.

### 2. Local Document & PDF Parsing (Offline RAG)
- Upload `.txt`, `.md` or `.pdf` files from your phone.
- Text is extracted entirely client-side (PDF.js).
- Documents are chunked and stored in IndexedDB.
- When you ask a question, Bob retrieves the most relevant chunks and uses them as context — completely offline.

### 3. Semantic-style Retrieval
A fast keyword + overlap retriever currently powers document RAG (works on every device).  
The architecture is ready to swap in a true local embedding model (e.g. all-MiniLM) later when WebGPU support is more universal on iOS.

### 4. Everything from previous versions
- Chain-of-Thought with collapsible 🧠 Thinking blocks
- Self-Healing tool loop
- Self-Improvement rules that are learned and injected
- Team mode (Planner → Writer → Reviewer)
- Voice in/out, continuous conversation
- Export / Import full memory (JSON)
- ~400 message history + permanent profile + documents

## How to use the new memory features

1. Open **Settings ⚙️**
2. **View / edit User Profile** – see or manually refine what Bob has learned about you
3. **Upload document** – add PDFs, notes, ebooks, etc. Bob can then answer questions about them offline
4. Keep chatting – when history grows large, Bob automatically compresses old conversations into the permanent profile

## Privacy
Everything stays on your device. Documents, profile, rules and chat never leave the phone unless you explicitly use an online tool.

---

Made for fun. Stay crazy. Now with real long-term memory and offline document RAG.
