#include <stdint.h>

// The Foldopia sheet has 256 facets, with at most three neighbours each.
enum { FACETS = 256, EDGES = 3 };
static int16_t neighbors[FACETS * EDGES];
static uint16_t order[FACETS];
static int16_t grouped[FACETS];

int16_t *neighbor_buffer(void) { return neighbors; }
uint16_t *order_buffer(void) { return order; }
int16_t *grouped_buffer(void) { return grouped; }

void group_facets(unsigned count) {
    uint8_t remaining[FACETS] = {0};
    uint16_t todo[FACETS];
    unsigned write = 0;
    for (unsigned i = 0; i < count; ++i) remaining[order[i]] = 1;
    for (unsigned i = 0; i < count; ++i) {
        unsigned root = order[i];
        if (!remaining[root]) continue;
        remaining[root] = 0;
        grouped[write++] = (int16_t)~root;
        todo[0] = root;
        unsigned pending = 1;
        while (pending > 0) {
            unsigned facet = todo[--pending];
            for (unsigned edge = 0; edge < EDGES; ++edge) {
                int neighbor = neighbors[facet * EDGES + edge];
                if (neighbor < 0 || !remaining[neighbor]) continue;
                remaining[neighbor] = 0;
                grouped[write++] = neighbor;
                todo[pending++] = neighbor;
            }
        }
    }
}
