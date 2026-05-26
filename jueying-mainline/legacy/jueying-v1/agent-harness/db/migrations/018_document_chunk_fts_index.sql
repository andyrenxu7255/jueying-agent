-- Add GIN index for full-text search on document_chunk.search_tsv
-- This enables efficient PostgreSQL full-text search queries
-- Previously queries on search_tsv had to perform sequential scans
-- 
-- This fixes performance bottleneck P-005 identified in the dependency audit:
-- "document_chunk search_tsv PostgreSQL tsvector field missing dedicated GIN index"
-- 
-- Impact: Full-text search queries on document chunks will now use index scan
--          instead of sequential scan, reducing query latency from O(n) to O(log n)

CREATE INDEX IF NOT EXISTS idx_document_chunk_fts ON document_chunk USING GIN (search_tsv);
