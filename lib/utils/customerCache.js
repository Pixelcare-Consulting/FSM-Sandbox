// lib/utils/customerCache.js

/**
 * Enhanced Customer Data Caching Utility
 * Provides multi-level in-memory caching for customer data with TTL support,
 * performance monitoring, and advanced cache invalidation strategies
 */
class CustomerCache {
  constructor() {
    // Multi-level cache storage
    this.cache = new Map();
    this.frequentCache = new Map(); // For frequently accessed items
    this.recentCache = new Map();   // For recently accessed items

    // Performance metrics
    this.hitCount = 0;
    this.missCount = 0;
    this.frequentHitCount = 0;
    this.recentHitCount = 0;
    this.evictionCount = 0;
    this.performanceMetrics = {
      averageResponseTime: 0,
      totalRequests: 0,
      cacheEfficiency: 0,
      memoryUsage: 0
    };

    // Cache configuration
    this.ttl = {
      customers: 5 * 60 * 1000,      // 5 minutes for customer lists
      customer: 10 * 60 * 1000,      // 10 minutes for individual customers
      search: 2 * 60 * 1000,         // 2 minutes for search results
      summary: 15 * 60 * 1000,       // 15 minutes for summary data
      count: 30 * 60 * 1000,         // 30 minutes for count queries
      frequent: 30 * 60 * 1000,      // 30 minutes for frequent cache
      recent: 5 * 60 * 1000          // 5 minutes for recent cache
    };

    // Cache size limits
    this.maxCacheSize = 1000;
    this.maxFrequentCacheSize = 100;
    this.maxRecentCacheSize = 50;

    // Access tracking for intelligent caching
    this.accessCount = new Map();
    this.lastAccess = new Map();

    // Clean expired entries every 5 minutes
    setInterval(() => this.cleanup(), 5 * 60 * 1000);

    // Performance monitoring interval
    setInterval(() => this.updatePerformanceMetrics(), 60 * 1000); // Every minute
  }

  /**
   * Generate cache key
   * @param {string} type - Cache type
   * @param {Object} params - Parameters to include in key
   * @returns {string} Cache key
   */
  generateKey(type, params = {}) {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((result, key) => {
        result[key] = params[key];
        return result;
      }, {});
    
    return `${type}:${JSON.stringify(sortedParams)}`;
  }

  /**
   * Set cache entry with intelligent placement
   * @param {string} key - Cache key
   * @param {*} data - Data to cache
   * @param {number} ttl - Time to live in milliseconds
   * @param {Object} options - Additional options
   */
  set(key, data, ttl = this.ttl.customers, options = {}) {
    const now = Date.now();
    const expiresAt = now + ttl;
    const entry = {
      data,
      expiresAt,
      createdAt: now,
      accessCount: 0,
      lastAccessed: now,
      size: this.calculateSize(data),
      priority: options.priority || 'normal'
    };

    // Check cache size limits and evict if necessary
    this.enforceMemoryLimits();

    // Store in appropriate cache level
    if (options.frequent || this.isFrequentlyAccessed(key)) {
      this.frequentCache.set(key, entry);
    } else if (options.recent || this.isRecentlyAccessed(key)) {
      this.recentCache.set(key, entry);
    } else {
      this.cache.set(key, entry);
    }

    // Update access tracking
    this.updateAccessTracking(key);
  }

  /**
   * Get cache entry with multi-level lookup
   * @param {string} key - Cache key
   * @returns {*} Cached data or null if not found/expired
   */
  get(key) {
    const startTime = Date.now();
    let entry = null;
    let cacheLevel = null;

    // Check frequent cache first
    entry = this.frequentCache.get(key);
    if (entry) {
      cacheLevel = 'frequent';
      this.frequentHitCount++;
    }

    // Check recent cache
    if (!entry) {
      entry = this.recentCache.get(key);
      if (entry) {
        cacheLevel = 'recent';
        this.recentHitCount++;
      }
    }

    // Check main cache
    if (!entry) {
      entry = this.cache.get(key);
      if (entry) {
        cacheLevel = 'main';
      }
    }

    if (!entry) {
      this.missCount++;
      this.recordPerformance(startTime, false);
      return null;
    }

    // Check expiration
    if (Date.now() > entry.expiresAt) {
      this.deleteFromAllCaches(key);
      this.missCount++;
      this.recordPerformance(startTime, false);
      return null;
    }

    // Update access information
    entry.accessCount++;
    entry.lastAccessed = Date.now();
    this.updateAccessTracking(key);

    // Promote to higher cache level if frequently accessed
    this.promoteIfNeeded(key, entry, cacheLevel);

    this.hitCount++;
    this.recordPerformance(startTime, true);
    return entry.data;
  }

  /**
   * Check if key exists and is not expired
   * @param {string} key - Cache key
   * @returns {boolean} True if key exists and is valid
   */
  has(key) {
    return this.get(key) !== null;
  }

  /**
   * Delete cache entry
   * @param {string} key - Cache key
   */
  delete(key) {
    this.cache.delete(key);
  }

  /**
   * Clear all cache entries
   */
  clear() {
    const entriesCleared = this.cache.size;
    this.cache.clear();
    console.log(`CustomerCache: Cleared ${entriesCleared} cache entries`);
    return entriesCleared;
  }

  /**
   * Force clear all cache and reset counters
   */
  forceReset() {
    const entriesCleared = this.cache.size;
    this.cache.clear();
    this.hitCount = 0;
    this.missCount = 0;
    console.log(`CustomerCache: Force reset - cleared ${entriesCleared} entries and reset counters`);
    return {
      entriesCleared,
      message: 'Cache completely reset'
    };
  }

  /**
   * Clean up expired entries from all cache levels
   */
  cleanup() {
    const now = Date.now();
    let cleanedCount = 0;

    // Clean main cache
    cleanedCount += this.cleanupCacheLevel(this.cache, 'main');

    // Clean frequent cache
    cleanedCount += this.cleanupCacheLevel(this.frequentCache, 'frequent');

    // Clean recent cache
    cleanedCount += this.cleanupCacheLevel(this.recentCache, 'recent');

    // Clean access tracking for removed entries
    this.cleanupAccessTracking();

    if (cleanedCount > 0) {
      console.log(`CustomerCache: Cleaned ${cleanedCount} expired entries across all cache levels`);
    }
  }

  /**
   * Clean up specific cache level
   * @param {Map} cache - Cache to clean
   * @param {string} level - Cache level name
   * @returns {number} Number of cleaned entries
   */
  cleanupCacheLevel(cache, level) {
    const now = Date.now();
    let cleanedCount = 0;

    for (const [key, entry] of cache.entries()) {
      if (now > entry.expiresAt) {
        cache.delete(key);
        cleanedCount++;
        this.evictionCount++;
      }
    }

    return cleanedCount;
  }

  /**
   * Get comprehensive cache statistics
   * @returns {Object} Cache statistics
   */
  getStats() {
    const now = Date.now();
    const stats = {
      main: this.getCacheLevelStats(this.cache, now),
      frequent: this.getCacheLevelStats(this.frequentCache, now),
      recent: this.getCacheLevelStats(this.recentCache, now)
    };

    const totalRequests = this.hitCount + this.missCount;
    const totalEntries = stats.main.totalEntries + stats.frequent.totalEntries + stats.recent.totalEntries;
    const totalValidEntries = stats.main.validEntries + stats.frequent.validEntries + stats.recent.validEntries;
    const totalExpiredEntries = stats.main.expiredEntries + stats.frequent.expiredEntries + stats.recent.expiredEntries;
    const totalSize = stats.main.totalSizeBytes + stats.frequent.totalSizeBytes + stats.recent.totalSizeBytes;

    return {
      // Overall statistics
      totalEntries,
      validEntries: totalValidEntries,
      expiredEntries: totalExpiredEntries,
      totalSizeBytes: totalSize,

      // Hit rate statistics
      hitRate: totalRequests > 0 ? (this.hitCount / totalRequests) * 100 : 0,
      hitCount: this.hitCount,
      missCount: this.missCount,
      frequentHitCount: this.frequentHitCount,
      recentHitCount: this.recentHitCount,

      // Performance metrics
      averageResponseTime: this.performanceMetrics.averageResponseTime,
      cacheEfficiency: this.performanceMetrics.cacheEfficiency,
      memoryUsage: this.performanceMetrics.memoryUsage,
      evictionCount: this.evictionCount,

      // Cache level breakdown
      cacheLevels: stats,

      // Access tracking
      totalTrackedKeys: this.accessCount.size,
      frequentlyAccessedKeys: Array.from(this.accessCount.entries())
        .filter(([, count]) => count >= 5).length,

      // Configuration
      configuration: {
        maxCacheSize: this.maxCacheSize,
        maxFrequentCacheSize: this.maxFrequentCacheSize,
        maxRecentCacheSize: this.maxRecentCacheSize,
        ttl: this.ttl
      }
    };
  }

  /**
   * Get statistics for a specific cache level
   * @param {Map} cache - Cache to analyze
   * @param {number} now - Current timestamp
   * @returns {Object} Cache level statistics
   */
  getCacheLevelStats(cache, now) {
    let validEntries = 0;
    let expiredEntries = 0;
    let totalSize = 0;

    for (const [key, entry] of cache.entries()) {
      if (now > entry.expiresAt) {
        expiredEntries++;
      } else {
        validEntries++;
      }
      totalSize += entry.size || 0;
    }

    return {
      totalEntries: cache.size,
      validEntries,
      expiredEntries,
      totalSizeBytes: totalSize,
      utilizationRate: cache.size > 0 ? (validEntries / cache.size) * 100 : 0
    };
  }

  /**
   * Cache customers list
   * @param {Object} params - Query parameters
   * @param {Array} customers - Customer data
   * @param {Object} pagination - Pagination info
   */
  cacheCustomers(params, customers, pagination) {
    const key = this.generateKey('customers', params);
    const data = { customers, pagination };
    this.set(key, data, this.ttl.customers);
  }

  /**
   * Get cached customers list
   * @param {Object} params - Query parameters
   * @returns {Object|null} Cached customer data
   */
  getCachedCustomers(params) {
    const key = this.generateKey('customers', params);
    return this.get(key);
  }

  /**
   * Cache individual customer
   * @param {string} cardCode - Customer CardCode
   * @param {Object} customer - Customer data
   */
  cacheCustomer(cardCode, customer) {
    const key = this.generateKey('customer', { cardCode });
    this.set(key, customer, this.ttl.customer);
  }

  /**
   * Get cached individual customer
   * @param {string} cardCode - Customer CardCode
   * @returns {Object|null} Cached customer data
   */
  getCachedCustomer(cardCode) {
    const key = this.generateKey('customer', { cardCode });
    return this.get(key);
  }

  /**
   * Cache masterlist bundle (partner + addressDetails + customerUuid).
   * @param {string} customerCode - Customer CardCode
   * @param {Object} bundle - Bundle payload
   */
  cacheCustomerBundle(customerCode, bundle) {
    const key = this.generateKey('customerBundle', { customerCode });
    this.set(key, bundle, this.ttl.customer);
  }

  /**
   * Get cached masterlist bundle.
   * @param {string} customerCode - Customer CardCode
   * @returns {Object|null} Cached bundle
   */
  getCachedCustomerBundle(customerCode) {
    const key = this.generateKey('customerBundle', { customerCode });
    return this.get(key);
  }

  /**
   * Cache search results
   * @param {Object} searchParams - Search parameters
   * @param {Array} results - Search results
   */
  cacheSearchResults(searchParams, results) {
    const key = this.generateKey('search', searchParams);
    this.set(key, results, this.ttl.search);
  }

  /**
   * Get cached search results
   * @param {Object} searchParams - Search parameters
   * @returns {Array|null} Cached search results
   */
  getCachedSearchResults(searchParams) {
    const key = this.generateKey('search', searchParams);
    return this.get(key);
  }

  /**
   * Cache customer summary
   * @param {Object} params - Query parameters
   * @param {Array} summary - Summary data
   */
  cacheSummary(params, summary) {
    const key = this.generateKey('summary', params);
    this.set(key, summary, this.ttl.summary);
  }

  /**
   * Get cached customer summary
   * @param {Object} params - Query parameters
   * @returns {Array|null} Cached summary data
   */
  getCachedSummary(params) {
    const key = this.generateKey('summary', params);
    return this.get(key);
  }

  /**
   * Cache count result
   * @param {Object} params - Query parameters
   * @param {number} count - Count result
   */
  cacheCount(params, count) {
    const key = this.generateKey('count', params);
    this.set(key, count, this.ttl.count);
  }

  /**
   * Get cached count result
   * @param {Object} params - Query parameters
   * @returns {number|null} Cached count
   */
  getCachedCount(params) {
    const key = this.generateKey('count', params);
    return this.get(key);
  }

  /**
   * Invalidate cache entries by pattern
   * @param {string} pattern - Pattern to match keys
   */
  invalidateByPattern(pattern) {
    const regex = new RegExp(pattern);
    let deletedCount = 0;

    for (const key of this.cache.keys()) {
      if (regex.test(key)) {
        this.cache.delete(key);
        deletedCount++;
      }
    }

    console.log(`CustomerCache: Invalidated ${deletedCount} entries matching pattern: ${pattern}`);
  }

  /**
   * Invalidate all customer-related cache
   * @param {string} cardCode - Optional specific customer CardCode
   */
  invalidateCustomer(cardCode = null) {
    if (cardCode) {
      // Invalidate specific customer
      this.invalidateByPattern(`customer:.*"cardCode":"${cardCode}"`);
      this.invalidateByPattern(`customerBundle:.*"customerCode":"${cardCode}"`);
      this.invalidateByPattern(`customers:.*`); // Also invalidate lists that might contain this customer
    } else {
      // Invalidate all customer cache
      this.invalidateByPattern(`customer.*`);
    }
  }

  /**
   * Calculate approximate size of data in bytes
   * @param {*} data - Data to calculate size for
   * @returns {number} Approximate size in bytes
   */
  calculateSize(data) {
    try {
      return JSON.stringify(data).length * 2; // Rough estimate (UTF-16)
    } catch (error) {
      return 1000; // Default size if calculation fails
    }
  }

  /**
   * Check if key is frequently accessed
   * @param {string} key - Cache key
   * @returns {boolean} True if frequently accessed
   */
  isFrequentlyAccessed(key) {
    const accessCount = this.accessCount.get(key) || 0;
    return accessCount >= 5; // Threshold for frequent access
  }

  /**
   * Check if key is recently accessed
   * @param {string} key - Cache key
   * @returns {boolean} True if recently accessed
   */
  isRecentlyAccessed(key) {
    const lastAccess = this.lastAccess.get(key) || 0;
    const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);
    return lastAccess > fiveMinutesAgo;
  }

  /**
   * Update access tracking for a key
   * @param {string} key - Cache key
   */
  updateAccessTracking(key) {
    const currentCount = this.accessCount.get(key) || 0;
    this.accessCount.set(key, currentCount + 1);
    this.lastAccess.set(key, Date.now());
  }

  /**
   * Promote entry to higher cache level if needed
   * @param {string} key - Cache key
   * @param {Object} entry - Cache entry
   * @param {string} currentLevel - Current cache level
   */
  promoteIfNeeded(key, entry, currentLevel) {
    if (currentLevel === 'main' && this.isFrequentlyAccessed(key)) {
      // Promote to frequent cache
      this.cache.delete(key);
      this.frequentCache.set(key, entry);
    } else if (currentLevel === 'main' && this.isRecentlyAccessed(key)) {
      // Promote to recent cache
      this.cache.delete(key);
      this.recentCache.set(key, entry);
    }
  }

  /**
   * Delete key from all cache levels
   * @param {string} key - Cache key
   */
  deleteFromAllCaches(key) {
    this.cache.delete(key);
    this.frequentCache.delete(key);
    this.recentCache.delete(key);
    this.accessCount.delete(key);
    this.lastAccess.delete(key);
  }

  /**
   * Enforce memory limits by evicting least recently used entries
   */
  enforceMemoryLimits() {
    // Enforce main cache limit
    if (this.cache.size >= this.maxCacheSize) {
      this.evictLRU(this.cache, Math.floor(this.maxCacheSize * 0.1)); // Evict 10%
    }

    // Enforce frequent cache limit
    if (this.frequentCache.size >= this.maxFrequentCacheSize) {
      this.evictLRU(this.frequentCache, Math.floor(this.maxFrequentCacheSize * 0.2)); // Evict 20%
    }

    // Enforce recent cache limit
    if (this.recentCache.size >= this.maxRecentCacheSize) {
      this.evictLRU(this.recentCache, Math.floor(this.maxRecentCacheSize * 0.3)); // Evict 30%
    }
  }

  /**
   * Evict least recently used entries from cache
   * @param {Map} cache - Cache to evict from
   * @param {number} count - Number of entries to evict
   */
  evictLRU(cache, count) {
    const entries = Array.from(cache.entries())
      .sort(([, a], [, b]) => a.lastAccessed - b.lastAccessed)
      .slice(0, count);

    entries.forEach(([key]) => {
      cache.delete(key);
      this.evictionCount++;
    });
  }

  /**
   * Clean up access tracking for non-existent entries
   */
  cleanupAccessTracking() {
    const allKeys = new Set([
      ...this.cache.keys(),
      ...this.frequentCache.keys(),
      ...this.recentCache.keys()
    ]);

    // Remove tracking for keys that no longer exist in any cache
    for (const key of this.accessCount.keys()) {
      if (!allKeys.has(key)) {
        this.accessCount.delete(key);
        this.lastAccess.delete(key);
      }
    }
  }

  /**
   * Record performance metrics
   * @param {number} startTime - Request start time
   * @param {boolean} hit - Whether it was a cache hit
   */
  recordPerformance(startTime, hit) {
    const responseTime = Date.now() - startTime;
    const totalRequests = this.performanceMetrics.totalRequests + 1;
    const currentAverage = this.performanceMetrics.averageResponseTime;

    this.performanceMetrics.averageResponseTime =
      (currentAverage * this.performanceMetrics.totalRequests + responseTime) / totalRequests;
    this.performanceMetrics.totalRequests = totalRequests;
  }

  /**
   * Update performance metrics
   */
  updatePerformanceMetrics() {
    const totalRequests = this.hitCount + this.missCount;
    this.performanceMetrics.cacheEfficiency = totalRequests > 0 ? (this.hitCount / totalRequests) * 100 : 0;

    // Calculate approximate memory usage
    let totalSize = 0;
    [this.cache, this.frequentCache, this.recentCache].forEach(cache => {
      for (const entry of cache.values()) {
        totalSize += entry.size || 0;
      }
    });
    this.performanceMetrics.memoryUsage = totalSize;
  }
}

// Create singleton instance
const customerCache = new CustomerCache();

export default customerCache;
