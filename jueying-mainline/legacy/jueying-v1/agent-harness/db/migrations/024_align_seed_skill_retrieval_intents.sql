-- Align existing seeded workflow skills with the current fact-retrieval intent taxonomy.
UPDATE skill_version
SET definition_json = replace(
  replace(
    replace(definition_json::text, '"intent_type":"factual_lookup"', '"intent_type":"object-status"'),
    '"intent_type":"code_search"',
    '"intent_type":"dev-context"'
  ),
  '"intent_type":"deep_analysis"',
  '"intent_type":"evidence"'
)::jsonb
WHERE definition_json::text LIKE '%"intent_type":"factual_lookup"%'
   OR definition_json::text LIKE '%"intent_type":"code_search"%'
   OR definition_json::text LIKE '%"intent_type":"deep_analysis"%';
