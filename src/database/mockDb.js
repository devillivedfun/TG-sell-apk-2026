/**
 * Lightweight, zero-dependency in-memory MongoDB mock collection and database.
 * Used for automated Vitest test suites and offline local testing.
 */

function matchesFilter(doc, filter) {
  if (!filter || Object.keys(filter).length === 0) return true;

  for (const [key, expected] of Object.entries(filter)) {
    if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
      if ('$gte' in expected) {
        if (!(doc[key] >= expected.$gte)) return false;
      }
      if ('$ne' in expected) {
        if (doc[key] === expected.$ne) return false;
      }
    } else {
      if (doc[key] !== expected) return false;
    }
  }
  return true;
}

export class MockCollection {
  constructor(name) {
    this.name = name;
    this.docs = [];
    this.indexes = [];
  }

  async createIndex(spec, options = {}) {
    this.indexes.push({ spec, options });
    return Object.keys(spec).join('_');
  }

  async insertOne(doc) {
    // Check unique indexes
    for (const { spec, options } of this.indexes) {
      if (options.unique) {
        for (const key of Object.keys(spec)) {
          if (options.sparse && (doc[key] === null || doc[key] === undefined)) {
            continue;
          }
          const exists = this.docs.some(
            (d) => d[key] !== undefined && d[key] !== null && d[key] === doc[key]
          );
          if (exists) {
            const err = new Error(`E11000 duplicate key error collection: ${this.name} index: ${key}`);
            err.code = 11000;
            throw err;
          }
        }
      }
    }

    const cloned = JSON.parse(JSON.stringify(doc));
    if (!cloned._id) {
      cloned._id = 'mock_' + Math.random().toString(36).slice(2);
    }
    this.docs.push(cloned);
    return { insertedId: cloned._id, acknowledged: true };
  }

  async findOne(filter) {
    const doc = this.docs.find((d) => matchesFilter(d, filter));
    return doc ? JSON.parse(JSON.stringify(doc)) : null;
  }

  find(filter = {}) {
    let results = this.docs.filter((d) => matchesFilter(d, filter));

    const cursor = {
      sort(sortObj) {
        const [field, direction] = Object.entries(sortObj)[0] || [];
        if (field) {
          results.sort((a, b) => {
            if (a[field] < b[field]) return direction === -1 ? 1 : -1;
            if (a[field] > b[field]) return direction === -1 ? -1 : 1;
            return 0;
          });
        }
        return cursor;
      },
      skip(n) {
        results = results.slice(n);
        return cursor;
      },
      limit(n) {
        results = results.slice(0, n);
        return cursor;
      },
      async toArray() {
        return results.map((d) => JSON.parse(JSON.stringify(d)));
      }
    };

    return cursor;
  }

  async updateOne(filter, update, options = {}) {
    let index = this.docs.findIndex((d) => matchesFilter(d, filter));

    if (index === -1) {
      if (options.upsert) {
        const newDoc = { ...filter };
        if (update.$set) Object.assign(newDoc, update.$set);
        if (update.$setOnInsert) Object.assign(newDoc, update.$setOnInsert);
        await this.insertOne(newDoc);
        return { matchedCount: 0, modifiedCount: 1, upsertedCount: 1 };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const doc = this.docs[index];
    if (update.$set) {
      Object.assign(doc, update.$set);
    }
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async countDocuments(filter = {}) {
    return this.docs.filter((d) => matchesFilter(d, filter)).length;
  }

  aggregate(pipeline = []) {
    return {
      toArray: async () => {
        // Implement $facet aggregation for getStats()
        for (const stage of pipeline) {
          if (stage.$facet) {
            const result = {};
            for (const [key, subPipeline] of Object.entries(stage.$facet)) {
              let currentDocs = [...this.docs];
              for (const subStage of subPipeline) {
                if (subStage.$match) {
                  currentDocs = currentDocs.filter((d) => matchesFilter(d, subStage.$match));
                }
                if (subStage.$count) {
                  currentDocs = [{ [subStage.$count]: currentDocs.length }];
                }
                if (subStage.$group) {
                  const sumField = subStage.$group.total?.$sum || subStage.$group.stars?.$sum;
                  let totalSum = 0;
                  if (sumField && sumField.startsWith('$')) {
                    const fieldName = sumField.slice(1);
                    totalSum = currentDocs.reduce((acc, curr) => acc + (Number(curr[fieldName]) || 0), 0);
                  }
                  currentDocs = [
                    {
                      _id: null,
                      total: totalSum,
                      stars: totalSum,
                      count: currentDocs.length
                    }
                  ];
                }
              }
              result[key] = currentDocs;
            }
            return [result];
          }
        }
        return [];
      }
    };
  }
}

export class MockDatabase {
  constructor() {
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new MockCollection(name));
    }
    return this.collections.get(name);
  }
}

export function createMockDb() {
  return new MockDatabase();
}
