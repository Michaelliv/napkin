# Benchmarks

Agentic retrieval benchmarks for pi + napkin. Each benchmark creates a temporary napkin vault, runs pi with the napkin-context extension, and measures retrieval accuracy and answer quality.

## LongMemEval

[LongMemEval](https://arxiv.org/abs/2410.10813) (ICLR 2025) tests long-term memory of chat assistants across 500 questions and five core abilities: information extraction, multi-session reasoning, knowledge updates, temporal reasoning, and abstention.

Three dataset sizes:

| Dataset | Sessions/question | Tokens | Tests |
|---------|-------------------|--------|-------|
| Oracle | 1-6 | ~5k | Reading comprehension |
| S | ~40-60 | ~115k | Retrieval + reading |
| M | ~500 | ~1.5M | Retrieval at scale |

### Results

**pi + napkin (Sonnet, 100 questions each):**

| Dataset | pi + napkin | Best prior system | Paper baseline (GPT-4o) |
|---------|-----------|-------------------|------------------------|
| Oracle | **92.0%** | 92.4% (GPT-4o+CoN) | 92.4% |
| S | **91.0%** | 86% (Emergence AI) | 64% (full context) |
| M | **83.0%** | 72% (GPT-4o RAG) | 72% |

Zero preprocessing - no embeddings, no graph construction, no summary extraction. Just BM25 search on per-round markdown notes.

Per-ability breakdown (S dataset, Sonnet):

| Ability | Accuracy |
|---------|----------|
| Information Extraction | 97.1% |
| Multi-Session Reasoning | 88.9% |
| Knowledge Updates | 100% |
| Temporal Reasoning | 90.3% |
| Abstention | 50.0% |

### How it works

1. Each question's chat history is split into **per-round notes** (one user message + following assistant responses per note)
2. Notes are organized in **day directories** (e.g., `2023-05-20/round-1.md`) so napkin's overview shows per-day keywords
3. File modification times are set from session timestamps for accurate recency ranking
4. The agent uses `napkin search` and `napkin read` to find and read relevant notes
5. An LLM judge (matching the paper's methodology) scores the answer

### Usage

```bash
# Oracle (smallest, downloads ~5MB)
npx tsx bench/longmemeval-eval.ts

# LongMemEval_S (~40 sessions per question, downloads ~50MB)
npx tsx bench/longmemeval-eval.ts --dataset s

# LongMemEval_M (~500 sessions, downloads ~2.6GB)
# Pre-extract a sample first:
python3 -c "import json,random; random.seed(42); d=json.load(open('bench/data/longmemeval_m_cleaned.json')); random.shuffle(d); json.dump(d[:100], open('bench/data/longmemeval_m_cleaned_sample100.json','w'))"
npx tsx bench/longmemeval-eval.ts --dataset m --n 100

# Common options
npx tsx bench/longmemeval-eval.ts --n 50                    # Limit questions
npx tsx bench/longmemeval-eval.ts --verbose                 # Show per-question results
npx tsx bench/longmemeval-eval.ts --json                    # Save full results JSON
npx tsx bench/longmemeval-eval.ts --concurrency 10          # Parallel questions
npx tsx bench/longmemeval-eval.ts --model "anthropic/claude-sonnet-4-20250514"
npx tsx bench/longmemeval-eval.ts --ids "id1,id2,id3"       # Run specific questions
npx tsx bench/longmemeval-eval.ts --seed 123                # Reproducible sampling
```

Data is downloaded automatically from HuggingFace on first run (except M which needs pre-extraction due to its 2.6GB size).

### Key design decisions

- **Per-round notes** instead of full sessions: each note is ~2.5k chars instead of ~15k, giving BM25 search better granularity
- **Day directories**: napkin's overview selects search-validated keywords per directory, giving the agent a topical map of the vault
- **Full assistant responses included**: many questions ask about what the assistant said previously - truncating assistant content drops answers
- **Scenario date in system prompt**: prevents the model from using its real current date for relative time calculations ("X days ago")
- **`--system-prompt` instead of `--append-system-prompt`**: avoids pi injecting a conflicting real date

## HotpotQA

Multi-hop question answering. 10 context paragraphs (2 gold, 8 distractors) per question. Tests whether the agent can find and chain information across notes.

```bash
npx tsx bench/hotpotqa-eval.ts
npx tsx bench/hotpotqa-eval.ts --n 100 --verbose
```

## LoCoMo

Long-term conversational memory. 10 conversations split into sessions, 699 questions across single-hop, multi-hop, and temporal reasoning.

```bash
npx tsx bench/locomo-eval.ts
npx tsx bench/locomo-eval.ts --sample 0 --verbose
```
