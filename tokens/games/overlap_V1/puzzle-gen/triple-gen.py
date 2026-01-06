import json
from collections import defaultdict

def find_word_groups(raw_word_list):
    # --- Configuration ---
    min_overlap = 1
    max_results = 10000

    # --- 1. Preparation ---
    # Ensure unique, lowercase, trimmed words
    # Filter empty strings
    words = sorted(list(set(w.strip().lower() for w in raw_word_list if w.strip())))
    word_set = set(words) # For O(1) lookups
    
    groups = []
    seen_groups = set() # To prevent duplicates

    # --- 2. Optimization: Prefix Map ---
    # Pre-calculates which words start with specific substrings
    # Key: prefix, Value: List of words
    starts_with_map = defaultdict(list)
    for w in words:
        for i in range(1, len(w) + 1):
            prefix = w[:i]
            starts_with_map[prefix].append(w)

    # --- 3. Main Algorithm ---
    for word_a in words:
        if len(groups) >= max_results:
            break

        # Iterate through every possible suffix of A (Overlap Length)
        # range(1, len(word_a) + 1) covers lengths 1 to len(word_a)
        for length in range(1, len(word_a) + 1):
            overlap_str = word_a[len(word_a) - length:]
            
            # Find potential 'C' words that start with this suffix
            candidates_c = starts_with_map.get(overlap_str)
            if not candidates_c:
                continue

            for word_c in candidates_c:
                if word_a == word_c:
                    continue

                # --- Portmanteau Construction ---
                # Combine A and C based on the overlap.
                p_part_c = word_c[length:]
                portmanteau = word_a + p_part_c

                # Define where the overlap sits within the combined string
                overlap_start = len(word_a) - length
                overlap_end = len(word_a)

                # --- Find Word B ---
                # Iterate through all substrings of the portmanteau to find valid words
                # Python string slicing [i:j]
                n_p = len(portmanteau)
                for i in range(n_p):
                    for j in range(i + 1, n_p + 1):
                        sub = portmanteau[i:j]

                        if sub in word_set:
                            word_b = sub

                            # Ensure B is distinct
                            if word_b == word_a or word_b == word_c:
                                continue

                            # --- Constraint: Start/End letters must be unique ---
                            starts = {word_a[0], word_b[0], word_c[0]}
                            ends = {word_a[-1], word_b[-1], word_c[-1]}

                            if len(starts) != 3 or len(ends) != 3:
                                continue

                            # --- Constraint: No word can be a substring of another ---
                            # (Except for the structural overlap required by the algo)
                            # We check if one word is entirely contained inside another unrelated to the bridge
                            if (word_b in word_a or word_a in word_b or
                                word_c in word_a or word_a in word_c or
                                word_c in word_b or word_b in word_c):
                                continue

                            # --- Overlap Intersection Check ---
                            # Check if Word B physically overlaps with the "bridge" between A and C.
                            # B exists at [i, j). Bridge exists at [overlapStart, overlapEnd).
                            intersect_start = max(i, overlap_start)
                            intersect_end = min(j, overlap_end)
                            triple_overlap_count = max(0, intersect_end - intersect_start)

                            if triple_overlap_count >= min_overlap:
                                # Create a unique key
                                output_key = f"{word_a}-{word_b}-{word_c}"

                                if output_key not in seen_groups:
                                    seen_groups.add(output_key)
                                    
                                    groups.append({
                                        "words": [word_a, word_b, word_c],
                                        "overlap": triple_overlap_count
                                    })

                                    if len(groups) >= max_results:
                                        return json.dumps(groups, indent=4)

    return json.dumps(groups, indent=4)

# --- Example Usage ---
if __name__ == "__main__":
    sample_words = [
        "anger", "germ", "ermine",
        "stone", "lonely", "one",
        "start", "art", "artist"
    ]
    
    # This will print the JSON string result
    print(find_word_groups(sample_words))