// Freestanding, single-threaded Foldopia generator for WebAssembly.
#include <stdint.h>

namespace {
constexpr int N = 8, S = 12, T = 4, Facets = N * N * 4;
constexpr int PositionSlots = 512, EdgeSlots = 1024, MaxFolds = 13;
constexpr int MaxLines = 4 * N;
enum Line { Vertical, Horizontal, Descending, Ascending };
enum Kind { Full, Flap, Tuck };
enum Paint { Neutral, Dark, Light };

int min(int a, int b) { return a < b ? a : b; }
int max(int a, int b) { return a > b ? a : b; }
int floor_cell(int v) { return v >= 0 ? v / S : (v - S + 1) / S; }

struct Rng {
    uint32_t seed;
    double next() {
        seed += 0x6d2b79f5u;
        uint32_t t = (seed ^ (seed >> 15)) * (seed | 1u);
        t ^= t + (t ^ (t >> 7)) * (t | 61u);
        return (t ^ (t >> 14)) / 4294967296.0;
    }
    int index(int count) { return int(next() * count); }
    template <typename Item>
    void shuffle(Item *items, int count) {
        for (int i = count - 1; i > 0; --i) {
            int j = index(i + 1);
            Item item = items[i];
            items[i] = items[j];
            items[j] = item;
        }
    }
};

struct Mask {
    uint64_t words[Facets / 64]{};
    bool has(int f) const { return (words[f / 64] >> (f % 64)) & 1; }
    void add(int f) { words[f / 64] |= uint64_t(1) << (f % 64); }
    void remove(int f) { words[f / 64] &= ~(uint64_t(1) << (f % 64)); }
};
struct Point { int x, y; };
struct Affine {
    int16_t a, b, c, d, tx, ty;
    Point apply(int x, int y) const { return {a*x + b*y + tx, c*x + d*y + ty}; }
    Affine compose(Affine t) const {
        return {int16_t(a*t.a + b*t.c), int16_t(a*t.b + b*t.d),
                int16_t(c*t.a + d*t.c), int16_t(c*t.b + d*t.d),
                int16_t(a*t.tx + b*t.ty + tx), int16_t(c*t.tx + d*t.ty + ty)};
    }
};
struct Box {
    int x0, y0, x1, y1;
    int width() const { return x1 - x0 + 1; }
    int height() const { return y1 - y0 + 1; }
};
struct Crease {
    Line t;
    int c, side;
    bool over;
    bool moves(int x, int y) const {
        int delta = value(t, x, y) - c * S;
        return side == 1 ? delta > 0 : delta < 0;
    }
    static int value(Line t, int x, int y) {
        switch (t) {
        case Vertical: return x;
        case Horizontal: return y;
        case Descending: return x - y;
        case Ascending: return x + y;
        }
        return 0;
    }
    Affine mirror() const {
        auto k = int16_t(c * S), twice = int16_t(2 * k);
        switch (t) {
        case Vertical: return {-1, 0, 0, 1, twice, 0};
        case Horizontal: return {1, 0, 0, -1, 0, twice};
        case Descending: return {0, 1, 1, 0, k, int16_t(-k)};
        case Ascending: return {0, -1, -1, 0, k, k};
        }
        return {};
    }
};
struct Move {
    Kind kind;
    Crease line;
    Box box;
    Mask flap;
    bool partial;
    int depth;
};

uint32_t hash_coordinate(int x, int y) {
    uint32_t key = uint32_t(x) * 100003u + uint32_t(y);
    key ^= key >> 16;
    key *= 0x7feb352du;
    return key ^ (key >> 15);
}

struct Span { uint16_t first, size; };
struct Position { int16_t x, y; Span stack; };
struct State {
    // Position order matches Map insertion order, independent of the coordinate index.
    int size;
    Position positions[Facets];
    uint16_t facets[Facets];
    Affine transform[Facets];
    uint8_t up[Facets];
    uint16_t slots[PositionSlots];

    void reset() {
        size = 0;
        __builtin_memset(slots, 0, sizeof(slots));
    }
    int slot(int x, int y) const {
        unsigned i = hash_coordinate(x, y) & (PositionSlots - 1);
        while (slots[i]) {
            const Position &p = positions[slots[i] - 1];
            if (p.x == x && p.y == y) break;
            i = (i + 1) & (PositionSlots - 1);
        }
        return i;
    }
    int find(int x, int y) const { return slots[slot(x, y)] - 1; }
    int ensure(int x, int y) {
        int i = slot(x, y);
        if (slots[i]) return slots[i] - 1;
        positions[size] = {int16_t(x), int16_t(y), {}};
        slots[i] = size + 1;
        return size++;
    }
    int facet(Span stack, int h) const { return facets[stack.first + h]; }
    Box bounds() const {
        Box b{32767, 32767, -32768, -32768};
        for (int i = 0; i < size; ++i) {
            int x = floor_cell(positions[i].x), y = floor_cell(positions[i].y);
            b.x0 = min(b.x0, x); b.x1 = max(b.x1, x);
            b.y0 = min(b.y0, y); b.y1 = max(b.y1, y);
        }
        return b;
    }
    int candidates(Line t, int *lines) const {
        int lo = 32767, hi = -32768;
        for (int i = 0; i < size; ++i) {
            int v = Crease::value(t, positions[i].x, positions[i].y);
            lo = min(lo, v); hi = max(hi, v);
        }
        int count = 0;
        for (int c = floor_cell(lo) + 1; c * S < hi; ++c) {
            if (count == MaxLines) __builtin_trap();
            lines[count++] = c;
        }
        return count;
    }
};

void init(State &m) {
    const int xOffset[] = {6, 10, 6, 2}, yOffset[] = {2, 6, 10, 6};
    m.reset();
    for (int f = 0; f < Facets; ++f) {
        int i = m.ensure((f / 4 % N) * S + xOffset[f % 4], (f / 4 / N) * S + yOffset[f % 4]);
        m.positions[i].stack = {uint16_t(f), 1};
        m.facets[f] = f;
        m.up[f] = 0;
        m.transform[f] = {1, 0, 0, 1, 0, 0};
    }
}

void apply(const State &m, const Move &move, State &out) {
    struct Lifted { Point point; Span stack; };
    uint16_t staying[Facets], moving[Facets];
    Lifted lifted[Facets];
    int stayingCount = 0, movingCount = 0, liftedCount = 0;
    Affine r = move.line.mirror();
    out.reset();
    for (int i = 0; i < m.size; ++i) {
        const Position &p = m.positions[i];
        bool moves = move.line.moves(p.x, p.y);
        int firstStay = stayingCount, firstMove = movingCount;
        for (int h = 0; h < p.stack.size; ++h) {
            int f = m.facet(p.stack, h);
            if (moves && (move.kind == Full || move.flap.has(f))) {
                moving[movingCount++] = f;
                out.up[f] = m.up[f] ^ 1;
                out.transform[f] = r.compose(m.transform[f]);
            } else {
                staying[stayingCount++] = f;
                out.up[f] = m.up[f];
                out.transform[f] = m.transform[f];
            }
        }
        if (stayingCount != firstStay) {
            int at = out.ensure(p.x, p.y);
            out.positions[at].stack = {uint16_t(firstStay), uint16_t(stayingCount - firstStay)};
        }
        if (movingCount != firstMove) {
            lifted[liftedCount++] = {r.apply(p.x, p.y), {uint16_t(firstMove), uint16_t(movingCount - firstMove)}};
        }
    }

    Span incoming[Facets]{};
    for (int i = 0; i < liftedCount; ++i) {
        const auto &group = lifted[i];
        // Reflection maps distinct source positions to distinct destinations.
        incoming[out.ensure(group.point.x, group.point.y)] = group.stack;
    }
    int write = 0;
    for (int i = 0; i < out.size; ++i) {
        Span stay = out.positions[i].stack, lift = incoming[i];
        int at = move.line.over ? stay.size : 0;
        if (move.kind == Tuck) {
            at = move.line.over ? max(0, stay.size - move.depth) : min(stay.size, move.depth);
        }
        out.positions[i].stack = {uint16_t(write), uint16_t(stay.size + lift.size)};
        for (int h = 0; h < at; ++h) out.facets[write++] = staying[stay.first + h];
        for (int h = lift.size - 1; h >= 0; --h) out.facets[write++] = moving[lift.first + h];
        for (int h = at; h < stay.size; ++h) out.facets[write++] = staying[stay.first + h];
    }
}

struct Neighbor { int facet, x, y; };
Neighbor neighbors[Facets][3];

int components(const State &m, Crease line, Mask *out, Mask &whole) {
    uint16_t order[Facets], todo[Facets];
    int count = 0;
    for (int i = 0; i < m.size; ++i) {
        const auto &p = m.positions[i];
        if (!line.moves(p.x, p.y)) continue;
        for (int h = 0; h < p.stack.size; ++h) {
            int f = m.facet(p.stack, h);
            order[count++] = f;
            whole.add(f);
        }
    }
    Mask remaining = whole;
    int groups = 0;
    for (int i = 0; i < count; ++i) {
        int f = order[i];
        if (!remaining.has(f)) continue;
        Mask part;
        remaining.remove(f);
        part.add(f);
        todo[0] = f;
        int pending = 1;
        while (pending) {
            for (const auto &nb : neighbors[todo[--pending]]) {
                if (nb.facet < 0 || !remaining.has(nb.facet)) continue;
                remaining.remove(nb.facet);
                part.add(nb.facet);
                todo[pending++] = nb.facet;
            }
        }
        out[groups++] = part;
    }
    return groups;
}

bool is_segment(const State &m, const Mask &flap, bool over) {
    for (int i = 0; i < m.size; ++i) {
        Span stack = m.positions[i].stack;
        bool inside = false;
        for (int h = 0; h < stack.size; ++h) {
            int f = m.facet(stack, over ? h : stack.size - 1 - h);
            if (flap.has(f)) inside = true;
            else if (inside) return false;
        }
    }
    return true;
}

bool valid(const State &m) {
    uint16_t where[Facets], height[Facets];
    for (int i = 0; i < m.size; ++i) {
        Span stack = m.positions[i].stack;
        for (int h = 0; h < stack.size; ++h) {
            int f = m.facet(stack, h);
            where[f] = i;
            height[f] = h;
        }
    }
    struct Edge { int x, y, head; };
    struct Crossing { uint16_t a, ha, b, hb, next; };
    Edge edges[EdgeSlots]{};
    int used[Facets * 3 / 2], edgeCount = 0, count = 0;
    Crossing records[Facets * 3 / 2];
    for (int i = 0; i < m.size; ++i) {
        Span stack = m.positions[i].stack;
        for (int h = 0; h < stack.size; ++h) {
            int f = m.facet(stack, h);
            for (const auto &nb : neighbors[f]) {
                int g = nb.facet;
                if (g < f) continue;
                Point p = m.transform[f].apply(nb.x, nb.y);
                unsigned at = hash_coordinate(p.x, p.y) & (EdgeSlots - 1);
                while (edges[at].head && (edges[at].x != p.x || edges[at].y != p.y)) {
                    at = (at + 1) & (EdgeSlots - 1);
                }
                Edge &edge = edges[at];
                if (!edge.head) {
                    edge = {p.x, p.y, 0};
                    used[edgeCount++] = at;
                }
                uint16_t a = i, b = where[g], ha = h, hb = height[g];
                if (a > b || (a == b && ha > hb)) {
                    uint16_t tmp = a; a = b; b = tmp;
                    tmp = ha; ha = hb; hb = tmp;
                }
                records[count++] = {a, ha, b, hb, uint16_t(edge.head)};
                edge.head = count;
            }
        }
    }
    for (int edge = 0; edge < edgeCount; ++edge) {
        for (int i = edges[used[edge]].head; i; i = records[i - 1].next) {
            const auto &a = records[i - 1];
            for (int j = a.next; j; j = records[j - 1].next) {
                const auto &b = records[j - 1];
                bool creaseA = a.a == a.b, creaseB = b.a == b.b;
                if (creaseA && creaseB) {
                    if (a.a != b.a) continue;
                    if ((a.ha < b.ha && b.ha < a.hb && a.hb < b.hb)
                        || (b.ha < a.ha && a.ha < b.hb && b.hb < a.hb)) return false;
                } else if (creaseA || creaseB) {
                    const auto &crease = creaseA ? a : b;
                    const auto &crossing = creaseA ? b : a;
                    int h = crossing.a == crease.a ? crossing.ha : crossing.hb;
                    if (crease.ha < h && h < crease.hb) return false;
                } else {
                    // The linked list is in reverse insertion order. Break ties as in JS's stable sort.
                    if (a.ha >= b.ha ? a.hb < b.hb : b.hb < a.hb) return false;
                }
            }
        }
    }
    return true;
}

bool propose(Rng &rng, const State &m, Line t, Kind kind, Move &out) {
    int lines[MaxLines], count = m.candidates(t, lines);
    if (!count) return false;
    Crease line{t, lines[rng.index(count)], rng.next() < 0.5 ? 1 : -1, rng.next() < 0.62};
    if (kind == Full) {
        out = {Full, line, m.bounds(), {}, false, 0};
        return true;
    }
    Mask parts[Facets], whole;
    int groups = components(m, line, parts, whole);
    if (groups < 2) return false;
    int allowed[Facets], size = 0;
    for (int i = 0; i < groups; ++i) {
        if (is_segment(m, parts[i], line.over)) allowed[size++] = i;
    }
    if (!size) return false;
    out = {Flap, line, m.bounds(), parts[allowed[rng.index(size)]], true, 0};
    return true;
}

bool find_tuck(Rng &rng, const State &m, Line first, State &scratch, Move &out) {
    Crease combos[2 * MaxLines * 4];
    int size = 0;
    for (int i = 0; i < 2; ++i) {
        Line t = Line(first + i);
        int lines[MaxLines], count = m.candidates(t, lines);
        for (int j = 0; j < count; ++j) {
            for (int side = 1; side >= -1; side -= 2) {
                combos[size++] = {t, lines[j], side, true};
                combos[size++] = {t, lines[j], side, false};
            }
        }
    }
    rng.shuffle(combos, size);
    Box box = m.bounds();
    Mask parts[Facets];
    for (int i = 0; i < size; ++i) {
        Crease line = combos[i];
        Mask whole;
        int groups = components(m, line, parts, whole);
        int choices[Facets + 1], count = 0;
        if (groups > 1) {
            for (int j = 0; j < groups; ++j) {
                if (is_segment(m, parts[j], line.over)) choices[count++] = j;
            }
        }
        choices[count++] = -1;
        rng.shuffle(choices, count);
        Affine r = line.mirror();
        for (int j = 0; j < count; ++j) {
            bool partial = choices[j] >= 0;
            const Mask &flap = partial ? parts[choices[j]] : whole;
            int maxDepth = 0;
            for (int k = 0; k < m.size; ++k) {
                const auto &p = m.positions[k];
                if (!line.moves(p.x, p.y)) continue;
                bool moving = false;
                for (int h = 0; h < p.stack.size; ++h) {
                    if (flap.has(m.facet(p.stack, h))) { moving = true; break; }
                }
                if (!moving) continue;
                Point dest = r.apply(p.x, p.y);
                int at = m.find(dest.x, dest.y);
                if (at >= 0) maxDepth = max(maxDepth, m.positions[at].stack.size);
            }
            if (maxDepth < 2) continue;
            int depths[Facets];
            for (int d = 1; d < maxDepth; ++d) depths[d - 1] = d;
            rng.shuffle(depths, maxDepth - 1);
            for (int d = 0; d < maxDepth - 1; ++d) {
                Move move{Tuck, line, box, flap, partial, depths[d]};
                apply(m, move, scratch);
                if (valid(scratch)) {
                    out = move;
                    return true;
                }
            }
        }
    }
    return false;
}

bool uses_front(const State &m) {
    for (int i = 0; i < m.size; ++i) {
        Span stack = m.positions[i].stack;
        if (m.up[m.facet(stack, stack.size - 1)] || !m.up[m.facet(stack, 0)]) return false;
    }
    return true;
}

struct Search {
    // Three reusable buffers: immutable flat sheet and alternating fold states.
    State flat, scratch[2];
    Move folds[MaxFolds];
    const State *last;
    int count;

    bool attempt(Rng &rng, int lo, int hi, int diag, int tech, bool single) {
        const State *m = &flat;
        int diagonals = 0, steps = 0;
        bool tucked = false, flapped = false;
        while (steps < hi) {
            State &next = scratch[steps % 2];
            int left = diag - diagonals;
            bool wantDiag = left > 0 && (left >= hi - steps || rng.next() < 0.45);
            Line first = wantDiag ? Descending : Vertical;
            Line t = Line(first + rng.index(2));
            double roll = rng.next();
            Kind kind = tech >= 2 && !tucked && steps > 0 && roll < 0.35 ? Tuck
                : tech >= 1 && roll < 0.6 ? Flap : Full;
            Move move;
            bool found = kind == Tuck ? find_tuck(rng, *m, first, next, move) : propose(rng, *m, t, kind, move);
            if (!found && kind != Full) found = propose(rng, *m, t, Full, move);
            if (!found) return false;
            // find_tuck already applied and validated its returned move in next.
            if (move.kind != Tuck) apply(*m, move, next);
            if (move.kind == Flap && !valid(next)) continue;
            m = &next;
            folds[steps++] = move;
            diagonals += move.line.t >= Descending;
            tucked |= move.kind == Tuck;
            flapped |= move.kind == Flap;
            Box b = m->bounds();
            if (m->size < T*T*4 || b.width() < T || b.height() < T) return false;
            if (m->size == T*T*4 && b.width() == T && b.height() == T) {
                if (steps < lo || diagonals != diag || (tech >= 1 && !tucked && !flapped)
                    || (tech >= 2 && !tucked) || (single && !uses_front(*m))) return false;
                count = steps;
                last = m;
                return true;
            }
        }
        return false;
    }
};

int paint_offset(int facet, int face) { return (facet / 4 * 2 + face) * 4 + facet % 4; }

constexpr int ResultCapacity = 4 + Facets * 2 + MaxFolds * (12 + Facets)
    + (MaxFolds + 1) * (1 + Facets * 11);
int32_t result[ResultCapacity];

struct Output {
    int32_t *next = result;
    void put(int value) { *next++ = value; }
    void move(const Move &m) {
        put(m.kind); put(m.line.t); put(m.line.c); put(m.line.side); put(m.line.over);
        put(m.partial); put(m.depth);
        put(m.box.x0); put(m.box.y0); put(m.box.x1); put(m.box.y1);
        int32_t *size = next++;
        *size = 0;
        for (int f = 0; f < Facets; ++f) {
            if (m.flap.has(f)) { put(f); ++*size; }
        }
    }
    void state(const State &m) {
        put(m.size);
        for (int i = 0; i < m.size; ++i) {
            const auto &p = m.positions[i];
            put(p.x); put(p.y); put(p.stack.size);
            for (int h = 0; h < p.stack.size; ++h) {
                int f = m.facet(p.stack, h);
                const auto &t = m.transform[f];
                put(f); put(m.up[f]); put(t.a); put(t.b); put(t.c); put(t.d); put(t.tx); put(t.ty);
            }
        }
    }
};

bool serialize(Search &search, Rng &rng, double decoy, int diag, bool single) {
    const State &m = *search.last;
    int top = rng.next() < 0.5 ? Dark : Light;
    int bottom = top == Dark ? Light : Dark;
    uint8_t paint[Facets * 2]{};
    for (int i = 0; i < m.size; ++i) {
        Span stack = m.positions[i].stack;
        int a = m.facet(stack, stack.size - 1), b = m.facet(stack, 0);
        paint[paint_offset(a, m.up[a])] = top;
        paint[paint_offset(b, m.up[b] ^ 1)] = bottom;
    }
    int whole[3]{};
    if (diag) {
        for (int i = 0; i < Facets * 2; i += 4) {
            const auto *q = paint + i;
            if (q[0] == q[1] && q[0] == q[2] && q[0] == q[3]) ++whole[q[0]];
        }
        if (whole[Dark] >= T*T && whole[Light] >= T*T) return false;
    }
    int decoys = 0;
    for (int cell = 0; cell < N*N; ++cell) {
        for (int face = 0; face < (single ? 1 : 2); ++face) {
            uint8_t *q = &paint[paint_offset(cell * 4, face)];
            if (q[0] || q[1] || q[2] || q[3] || rng.next() >= decoy) continue;
            int col = rng.next() < 0.5 ? Dark : Light;
            if (diag && rng.next() < 0.35) {
                int half = rng.index(4);
                q[half] = q[(half + 1) % 4] = col;
            } else {
                int other = col == Dark ? Light : Dark;
                if (diag && whole[col] + 1 >= T*T && whole[other] >= T*T) continue;
                ++whole[col];
                for (int i = 0; i < 4; ++i) q[i] = col;
            }
            ++decoys;
        }
    }
    int under = 0, switches = 0, flaps = 0, tucks = 0;
    for (int i = 0; i < search.count; ++i) {
        const Move &move = search.folds[i];
        under += !move.line.over;
        switches += i > 0 && move.line.t != search.folds[i - 1].line.t;
        flaps += move.kind == Flap;
        tucks += move.kind == Tuck;
    }
    double score = search.count + under * 0.6 + switches * 0.4
        + diag * 1.2 + flaps * 1.0 + tucks * 1.8 + decoy * 6;
    int stars = max(1, min(5, int((score - 1.5) / 2 + 0.5)));
    Output out;
    out.put(search.count); out.put(top); out.put(decoys); out.put(stars);
    for (uint8_t q : paint) out.put(q);
    for (int i = 0; i < search.count; ++i) out.move(search.folds[i]);
    const State *state = &search.flat;
    out.state(*state);
    for (int i = 0; i < search.count; ++i) {
        State &next = search.scratch[i % 2];
        apply(*state, search.folds[i], next);
        if (!valid(next)) return false;
        out.state(next);
        state = &next;
    }
    return true;
}
} // namespace

extern "C" {
void set_neighbor(int facet, int edge, int neighbor, int x, int y) {
    neighbors[facet][edge] = {neighbor, x, y};
}

const int32_t *generate_puzzle(int seed, int lo, int hi, double decoy, int diag, int tech, int single) {
    if (lo < 2 || hi < lo || hi > MaxFolds || diag < 0 || diag > 3 || tech < 0 || tech > 2) return nullptr;
    Rng rng{uint32_t(seed) * 7919u + 17u + uint32_t(diag) * 104729u + uint32_t(tech) * 1299709u};
    Search search;
    init(search.flat);
    for (int attempt = 0; attempt < 18000; ++attempt) {
        if (search.attempt(rng, lo, hi, diag, tech, single != 0)) {
            // Invalid candidates must not consume paint draws or stop the search for this seed.
            Rng paintRng = rng;
            if (serialize(search, paintRng, decoy, diag, single != 0)) return result;
        }
    }
    return nullptr;
}
}
