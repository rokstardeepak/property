/**
 * BARDHAMAN PROPERTY - MAIN APP SCRIPT
 * Handles:
 *  1. Dynamic Property Loading (Firestore + LocalStorage Fallback)
 *  2. WhatsApp Floating Button Actions
 *  3. Static Review Carousels and Animations
 *  4. Mobile Navigation Toggles
 *  5. New Property Uploading and Deletion via Admin.html
 */

import { initializeApp } from 'firebase/app';
import { 
  getFirestore, 
  collection, 
  addDoc, 
  getDocs, 
  deleteDoc, 
  doc, 
  getDocFromServer,
  query,
  orderBy,
  setDoc
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

// Initialize Firebase safely
let db: any = null;
let firebaseActive = false;

try {
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
  firebaseActive = true;
} catch (error) {
  console.warn("Firebase not loaded. Transitioning to full LocalStorage fallback mode.", error);
}

// Default Premium Property Listings to seed if Storage is empty
const DEFAULT_PROPERTIES = [
  {
    id: "def-1",
    title: "Western Hills Luxury Mansion",
    location: "Near Kokane Chowk, Pimple Saudagar, Pune",
    bhk: "4 BHK Ultra-Premium Penthouse",
    price: "₹2.25 Cr",
    instagramUrl: "https://www.instagram.com/reel/DXlw9FljCRJ/",
    listingType: "Sell"
  },
  {
    id: "def-2",
    title: "The Crown Residences",
    location: "Kokane Chowk, Pimple Saudagar, Pune",
    bhk: "3 BHK Premium Flat",
    price: "₹45,000/Month",
    instagramUrl: "https://www.instagram.com/reel/CyXzM63pG2M/",
    listingType: "Rent"
  },
  {
    id: "def-3",
    title: "Green Olive Heights",
    location: "Rover-PCMC, Pimple Saudagar Area, Pune",
    bhk: "2 BHK Smart Premium Apartment",
    price: "₹85 Lakhs",
    instagramUrl: "https://www.instagram.com/reel/C2F60A3pyf9/",
    listingType: "Sell"
  },
  {
    id: "def-4",
    title: "Grand Bay Enclave",
    location: "Brt Road, Pimple Saudagar, Pune",
    bhk: "3 BHK Luxury View Suite",
    price: "₹38,000/Month",
    instagramUrl: "https://www.instagram.com/reel/C4Vz6i_p8Zk/",
    listingType: "Rent"
  }
];

// Helper to convert Instagram standard/mobile reel links to Embed links
export function getInstagramEmbedUrl(url: string): string {
  if (!url) return '';
  const cleanUrl = url.trim();
  if (cleanUrl.includes('/embed')) return cleanUrl;

  // Pattern matches typical reel / p / reels / tv followed by the ID
  const regex = /(?:reel|p|reels|tv)\/([a-zA-Z0-9_\-]+)/;
  const match = cleanUrl.match(regex);
  if (match && match[1]) {
    // Use /p/ format for ALL links (including Reels) because /p/.../embed/ is the standard video-post format,
    // which allows users to play the video directly inside the iframe/website without redirecting to Instagram.
    return `https://www.instagram.com/p/${match[1]}/embed/`;
  }

  // General fallback parsing or appending embed
  try {
    const parted = cleanUrl.split('?')[0];
    const ended = parted.endsWith('/') ? parted : `${parted}/`;
    return `${ended}embed/`;
  } catch (e) {
    return url;
  }
}

// 1. Core Data Repository: Combines Firestore + LocalStorage
export interface Property {
  id?: string;
  title: string;
  location: string;
  bhk: string;
  price: string;
  instagramUrl: string;
  listingType?: string;
  createdAt?: number;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: null,
      email: null,
      emailVerified: null,
      isAnonymous: null,
      tenantId: null,
      providerInfo: []
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Fetch all properties
export async function fetchProperties(): Promise<Property[]> {
  let items: Property[] = [];
  
  if (firebaseActive && db) {
    try {
      // Test remote connection using server-verification trick
      await getDocFromServer(doc(db, 'system_test', 'connection')).catch(() => {});
      
      const q = query(collection(db, 'properties'), orderBy('createdAt', 'desc'));
      let snapshot;
      try {
        snapshot = await getDocs(q);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, 'properties');
        throw err; // won't reach here as handleFirestoreError throws
      }
      
      snapshot.forEach(docSnap => {
        const data = docSnap.data();
        let normalizedCreatedAt = data.createdAt;
        if (normalizedCreatedAt && typeof normalizedCreatedAt === 'object') {
          if ('seconds' in normalizedCreatedAt) {
            normalizedCreatedAt = normalizedCreatedAt.seconds * 1000 + Math.floor((normalizedCreatedAt.nanoseconds || 0) / 1000000);
          } else if ('_seconds' in normalizedCreatedAt) {
            normalizedCreatedAt = (normalizedCreatedAt as any)._seconds * 1000;
          } else if (typeof (normalizedCreatedAt as any).toDate === 'function') {
            normalizedCreatedAt = (normalizedCreatedAt as any).toDate().getTime();
          }
        }
        
        items.push({
          id: docSnap.id,
          ...data,
          createdAt: normalizedCreatedAt || Date.now()
        } as Property);
      });
      
      // Auto-synchronize def-1 in Firestore if its Instagram URL is outdated or if it needs listingType
      const def1InFirestore = items.find(item => item.id === 'def-1');
      if (def1InFirestore && (def1InFirestore.instagramUrl !== DEFAULT_PROPERTIES[0].instagramUrl || !def1InFirestore.listingType)) {
        def1InFirestore.instagramUrl = DEFAULT_PROPERTIES[0].instagramUrl;
        def1InFirestore.listingType = DEFAULT_PROPERTIES[0].listingType;
        
        // Also normalize its createdAt
        let def1CreatedAt: any = def1InFirestore.createdAt;
        if (def1CreatedAt && typeof def1CreatedAt === 'object') {
          if ('seconds' in def1CreatedAt) {
            def1CreatedAt = def1CreatedAt.seconds * 1000 + Math.floor((def1CreatedAt.nanoseconds || 0) / 1000000);
          } else if ('_seconds' in def1CreatedAt) {
            def1CreatedAt = def1CreatedAt._seconds * 1000;
          } else if (typeof def1CreatedAt.toDate === 'function') {
            def1CreatedAt = def1CreatedAt.toDate().getTime();
          }
        }
        const finalDef1CreatedAt = def1CreatedAt || (Date.now() - 3000);

        try {
          await setDoc(doc(db, 'properties', 'def-1'), {
            title: def1InFirestore.title,
            location: def1InFirestore.location,
            bhk: def1InFirestore.bhk,
            price: def1InFirestore.price,
            instagramUrl: DEFAULT_PROPERTIES[0].instagramUrl,
            listingType: DEFAULT_PROPERTIES[0].listingType,
            createdAt: finalDef1CreatedAt
          });
          console.log("Auto-synchronized def-1 link in Firestore.");
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, 'properties/def-1');
        }
      }
      
      // If Firestore is completely empty, seed it with default premium properties once
      if (items.length === 0) {
        console.log("Firestore is empty. Seeding default properties to Firestore...");
        for (let i = 0; i < DEFAULT_PROPERTIES.length; i++) {
          const prop = DEFAULT_PROPERTIES[i];
          const seededPayload = {
            title: prop.title,
            location: prop.location,
            bhk: prop.bhk,
            price: prop.price,
            instagramUrl: prop.instagramUrl,
            listingType: prop.listingType,
            // Slightly offset timestamps so order is perfect
            createdAt: Date.now() - (i * 1000)
          };
          try {
            await setDoc(doc(db, 'properties', prop.id), seededPayload);
          } catch (err) {
            handleFirestoreError(err, OperationType.WRITE, `properties/${prop.id}`);
          }
          items.push({
            id: prop.id,
            ...seededPayload
          });
        }
      }
      
      // Cache fetched items to localStorage
      localStorage.setItem('cached_properties', JSON.stringify(items));
      console.log("Successfully fetched properties from Firestore.");
    } catch (firebaseErr) {
      console.error("Firestore fetch error. Falling back to LocalStorage.", firebaseErr);
      items = getLocalStorageProperties();
    }
  } else {
    items = getLocalStorageProperties();
  }

  // Ensure def-1 in local items is also synchronized to DEFAULT_PROPERTIES[0]
  const def1Local = items.find(item => item.id === 'def-1');
  if (def1Local && def1Local.instagramUrl !== DEFAULT_PROPERTIES[0].instagramUrl) {
    def1Local.instagramUrl = DEFAULT_PROPERTIES[0].instagramUrl;
    localStorage.setItem('cached_properties', JSON.stringify(items));
  }

  // If both sources are completely empty, seed standard properties for mock completeness locally
  if (items.length === 0) {
    items = DEFAULT_PROPERTIES;
    localStorage.setItem('cached_properties', JSON.stringify(DEFAULT_PROPERTIES));
  }
  
  return items;
}

// Helper to load from LocalStorage
function getLocalStorageProperties(): Property[] {
  const local = localStorage.getItem('cached_properties');
  if (local) {
    try {
      return JSON.parse(local);
    } catch (e) {
      return [];
    }
  }
  return [];
}

// Upload a new property
export async function uploadProperty(property: Omit<Property, 'id'>): Promise<boolean> {
  const payload = {
    ...property,
    createdAt: Date.now()
  };

  let docId = "";

  // 1. Try Firestore
  if (firebaseActive && db) {
    try {
      const docRef = await addDoc(collection(db, 'properties'), payload);
      docId = docRef.id;
      console.log("Successfully uploaded to Firestore with ID:", docId);
    } catch (err) {
      console.error("Firestore upload failed, saving to local only.", err);
      handleFirestoreError(err, OperationType.CREATE, 'properties');
    }
  }

  // 2. Mirror/Fallback in LocalStorage
  const currentLocal = getLocalStorageProperties();
  if (currentLocal.length === 0) {
    // Add default items so we don't overwrite empty list with single item
    currentLocal.push(...DEFAULT_PROPERTIES);
  }
  
  const newItemWithId: Property = {
    id: docId || ("local-" + Math.random().toString(36).substr(2, 9)),
    ...payload
  };
  
  currentLocal.unshift(newItemWithId);
  localStorage.setItem('cached_properties', JSON.stringify(currentLocal));

  return true;
}

// Update/Edit an existing property
export async function updateProperty(id: string, property: Omit<Property, 'id' | 'createdAt'>, createdAt?: any): Promise<boolean> {
  let originalCreatedAt = createdAt || Date.now();
  if (originalCreatedAt && typeof originalCreatedAt === 'object') {
    if ('seconds' in originalCreatedAt) {
      originalCreatedAt = originalCreatedAt.seconds * 1000 + Math.floor((originalCreatedAt.nanoseconds || 0) / 1000000);
    } else if ('_seconds' in originalCreatedAt) {
      originalCreatedAt = (originalCreatedAt as any)._seconds * 1000;
    } else if (typeof (originalCreatedAt as any).toDate === 'function') {
      originalCreatedAt = (originalCreatedAt as any).toDate().getTime();
    }
  }
  const payload = {
    ...property,
    createdAt: originalCreatedAt
  };

  // 1. Try Firestore
  if (firebaseActive && db) {
    try {
      await setDoc(doc(db, 'properties', id), payload);
      console.log("Successfully updated in Firestore:", id);
    } catch (err) {
      console.error("Firestore update failed, saving to local only.", err);
      handleFirestoreError(err, OperationType.UPDATE, `properties/${id}`);
    }
  }

  // 2. Mirror/Fallback in LocalStorage
  const currentLocal = getLocalStorageProperties();
  const index = currentLocal.findIndex(item => item.id === id);
  if (index !== -1) {
    currentLocal[index] = {
      id,
      ...payload
    };
  } else {
    // If it was loaded from Firestore but not in local cache yet, let's update/add it:
    currentLocal.unshift({
      id,
      ...payload
    });
  }
  localStorage.setItem('cached_properties', JSON.stringify(currentLocal));

  return true;
}

// Delete a property
export async function deleteProperty(id: string): Promise<boolean> {
  // 1. Write to Firestore
  if (firebaseActive && db) {
    try {
      await deleteDoc(doc(db, 'properties', id));
      console.log("Deleted document from Firestore: ", id);
    } catch (err) {
      console.error("Firestore deletion failed.", err);
      handleFirestoreError(err, OperationType.DELETE, `properties/${id}`);
    }
  }

  // 2. Remove from LocalStorage cache
  const currentLocal = getLocalStorageProperties().filter(item => item.id !== id);
  localStorage.setItem('cached_properties', JSON.stringify(currentLocal));
  
  return true;
}

// Page Navigation highlight & Mobile Burger Menu logic
document.addEventListener('DOMContentLoaded', async () => {
  // Mobile menu toggle
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');
  
  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener('click', () => {
      mobileMenu.classList.toggle('hidden');
    });
  }

  // Set active link highlight based on current path
  const currentPath = window.location.pathname;
  const menuLinks = document.querySelectorAll('.nav-link');
  menuLinks.forEach((link: any) => {
    const href = link.getAttribute('href');
    if (href && currentPath.endsWith(href)) {
      link.classList.add('text-[#E53E3E]');
      link.classList.remove('text-[#9CA3AF]');
    }
  });

  // Handle Home Reviews Slider (Dynamic or Auto Scroll helper)
  const reviewsScroll = document.getElementById('reviews-scroll');
  const scrollLeftBtn = document.getElementById('reviews-prev');
  const scrollRightBtn = document.getElementById('reviews-next');

  if (reviewsScroll && scrollLeftBtn && scrollRightBtn) {
    scrollLeftBtn.addEventListener('click', () => {
      reviewsScroll.scrollBy({ left: -320, behavior: 'smooth' });
    });
    scrollRightBtn.addEventListener('click', () => {
      reviewsScroll.scrollBy({ left: 320, behavior: 'smooth' });
    });
  }

  function parseBudgetDropdown(val: string): { minBudget: number; maxBudget: number; isRent: boolean | null } {
    if (val === "rent_15k_50k") {
      return { minBudget: 15000, maxBudget: 50000, isRent: true };
    } else if (val === "rent_50k_1lakh") {
      return { minBudget: 50000, maxBudget: 100000, isRent: true };
    } else if (val === "buy_1l_50l") {
      return { minBudget: 100000, maxBudget: 5000000, isRent: false };
    } else if (val === "buy_50l_2cr") {
      return { minBudget: 5000000, maxBudget: 20000000, isRent: false };
    } else if (val === "buy_2cr_plus") {
      return { minBudget: 20000000, maxBudget: Infinity, isRent: false };
    }
    return { minBudget: 0, maxBudget: Infinity, isRent: null };
  }

  // Global Navbar Search Logic callbacks
  let triggerPropFiltersUpdate: (() => void) | null = null;
  let triggerHomeFiltersUpdate: (() => void) | null = null;

  const navSearchInput = document.getElementById('nav-search-input') as HTMLInputElement;
  const mobileNavSearchInput = document.getElementById('mobile-nav-search-input') as HTMLInputElement;

  // Read URL query parameter for search if present on landing
  const urlParams = new URLSearchParams(window.location.search);
  const urlSearchParam = urlParams.get('search');
  if (urlSearchParam) {
    const decodedSearch = decodeURIComponent(urlSearchParam);
    if (navSearchInput) navSearchInput.value = decodedSearch;
    if (mobileNavSearchInput) mobileNavSearchInput.value = decodedSearch;
  }

  // Get current active search query across desktop/mobile
  const getNavbarSearchQuery = (): string => {
    if (navSearchInput) {
      return navSearchInput.value.trim();
    }
    if (mobileNavSearchInput) {
      return mobileNavSearchInput.value.trim();
    }
    return "";
  };

  // Synchronize desktop and mobile nav search inputs, and run dynamic filter
  const syncAndTriggerNavbarFilters = (e: Event) => {
    const changedInput = e.target as HTMLInputElement;
    const val = changedInput.value;
    
    if (navSearchInput && changedInput !== navSearchInput) {
      navSearchInput.value = val;
    }
    if (mobileNavSearchInput && changedInput !== mobileNavSearchInput) {
      mobileNavSearchInput.value = val;
    }

    if (triggerPropFiltersUpdate) {
      triggerPropFiltersUpdate();
    }
    if (triggerHomeFiltersUpdate) {
      triggerHomeFiltersUpdate();
    }
  };

  if (navSearchInput) navSearchInput.addEventListener('input', syncAndTriggerNavbarFilters);
  if (mobileNavSearchInput) mobileNavSearchInput.addEventListener('input', syncAndTriggerNavbarFilters);

  // Pressing Enter redirects on pages other than properties.html
  const handleNavbarSearchEnter = (e: KeyboardEvent) => {
    if (e.key === 'Enter') {
      const val = (e.target as HTMLInputElement).value.trim();
      const isPropertiesPage = window.location.pathname.endsWith('properties.html');
      
      if (!isPropertiesPage) {
        window.location.href = `properties.html?search=${encodeURIComponent(val)}`;
      }
    }
  };

  if (navSearchInput) navSearchInput.addEventListener('keypress', handleNavbarSearchEnter);
  if (mobileNavSearchInput) mobileNavSearchInput.addEventListener('keypress', handleNavbarSearchEnter);

  // Render properties dynamically if we are on properties page
  const propertiesGrid = document.getElementById('properties-grid');
  const propBhk = document.getElementById('prop-filter-bhk') as HTMLSelectElement;
  const propLoc = document.getElementById('prop-filter-location') as HTMLSelectElement;
  const propType = document.getElementById('prop-filter-type') as HTMLSelectElement;
  const propPriceSelect = document.getElementById('prop-filter-price-select') as HTMLSelectElement;
  const propReset = document.getElementById('prop-filter-reset');

  if (propertiesGrid) {
    const updatePropFilters = () => {
      const budgetVal = propPriceSelect ? propPriceSelect.value : "All";
      const budgetParsed = parseBudgetDropdown(budgetVal);

      const filters = {
        searchKeyword: getNavbarSearchQuery(),
        bhk: propLoc ? propLoc.value : "All", // Location slot holds Layout CONFIGURATION list
        location: propBhk ? propBhk.value : "All", // BHK size slot holds GEOGRAPHIC LOCALITY list
        priceRange: "All",
        listingType: propType ? propType.value : "All",
        sliderMaxBudget: budgetParsed.maxBudget,
        sliderIsRent: budgetParsed.isRent,
        sliderMinBudget: budgetParsed.minBudget
      };
      renderPropertiesGrid(propertiesGrid, filters);
    };

    triggerPropFiltersUpdate = updatePropFilters;

    if (propBhk) propBhk.addEventListener('change', updatePropFilters);
    if (propLoc) propLoc.addEventListener('change', updatePropFilters);
    if (propType) propType.addEventListener('change', updatePropFilters);
    if (propPriceSelect) {
      propPriceSelect.addEventListener('change', updatePropFilters);
    }

    if (propReset) {
      propReset.addEventListener('click', () => {
        if (propBhk) propBhk.value = "All";
        if (propLoc) propLoc.value = "All";
        if (propType) propType.value = "All";
        if (propPriceSelect) propPriceSelect.value = "All";
        if (navSearchInput) navSearchInput.value = "";
        if (mobileNavSearchInput) mobileNavSearchInput.value = "";
        updatePropFilters();
      });
    }

    // Initial load
    updatePropFilters();
  }

  // Render recent properties dynamically if we are on home page
  const recentPropertiesGrid = document.getElementById('recent-properties-grid');
  const homeBhk = document.getElementById('home-filter-bhk') as HTMLSelectElement;
  const homeLoc = document.getElementById('home-filter-location') as HTMLSelectElement;
  const homeType = document.getElementById('home-filter-type') as HTMLSelectElement;
  const homePriceSelect = document.getElementById('home-filter-price-select') as HTMLSelectElement;
  const homeReset = document.getElementById('home-reset-inner-filters') || document.getElementById('home-filter-reset');

  if (recentPropertiesGrid) {
    const updateHomeFilters = () => {
      const budgetVal = homePriceSelect ? homePriceSelect.value : "All";
      const budgetParsed = parseBudgetDropdown(budgetVal);

      const filters = {
        searchKeyword: getNavbarSearchQuery(),
        bhk: homeLoc ? homeLoc.value : "All", // Location slot holds Layout CONFIGURATION list
        location: homeBhk ? homeBhk.value : "All", // BHK size slot holds GEOGRAPHIC LOCALITY list
        priceRange: "All",
        listingType: homeType ? homeType.value : "All",
        sliderMaxBudget: budgetParsed.maxBudget,
        sliderIsRent: budgetParsed.isRent,
        sliderMinBudget: budgetParsed.minBudget
      };
      renderRecentPropertiesGrid(recentPropertiesGrid, filters);
    };

    triggerHomeFiltersUpdate = updateHomeFilters;

    if (homeBhk) homeBhk.addEventListener('change', updateHomeFilters);
    if (homeLoc) homeLoc.addEventListener('change', updateHomeFilters);
    if (homeType) homeType.addEventListener('change', updateHomeFilters);
    if (homePriceSelect) {
      homePriceSelect.addEventListener('change', updateHomeFilters);
    }

    const setupHomeReset = () => {
      const resBtn = document.getElementById('home-filter-reset');
      if (resBtn) {
        resBtn.addEventListener('click', () => {
          if (homeBhk) homeBhk.value = "All";
          if (homeLoc) homeLoc.value = "All";
          if (homeType) homeType.value = "All";
          if (homePriceSelect) homePriceSelect.value = "All";
          if (navSearchInput) navSearchInput.value = "";
          if (mobileNavSearchInput) mobileNavSearchInput.value = "";
          updateHomeFilters();
        });
      }
    };
    setupHomeReset();

    // Initial load
    updateHomeFilters();
  }

  // Setup Admin functionality if we are on admin page
  const adminForm = document.getElementById('upload-property-form');
  const adminList = document.getElementById('admin-properties-list');
  if (adminForm && adminList) {
    setupAdminPanel(adminForm as HTMLFormElement, adminList);
  }
});

interface NormalizedPrice {
  value: number; // in Rupees
  isRent: boolean;
}

export function normalizePrice(priceStr: string, listingType?: string): NormalizedPrice {
  let isRent = false;
  let cleanPrice = priceStr.toLowerCase().replace(/,/g, '').trim();
  
  if (cleanPrice.includes('/month') || cleanPrice.includes('month') || cleanPrice.includes('/mo') || cleanPrice.includes('rent')) {
    isRent = true;
  }
  if (listingType && (listingType.toLowerCase() === "rent" || listingType.toLowerCase().includes("rent"))) {
    isRent = true;
  }
  
  // Extract number
  let match = cleanPrice.match(/[\d\.]+/);
  if (!match) {
    return { value: 0, isRent };
  }
  
  let val = parseFloat(match[0]);
  
  if (cleanPrice.includes('cr') || cleanPrice.includes('crore')) {
    val = val * 10000000;
  } else if (cleanPrice.includes('lakh') || cleanPrice.includes('l') || cleanPrice.includes('lakhs')) {
    val = val * 100000;
  } else if (cleanPrice.includes('k') || cleanPrice.includes('thousand')) {
    val = val * 1000;
  }
  
  return { value: val, isRent };
}

function matchesFilters(
  prop: Property, 
  searchKeyword: string, 
  bhk: string, 
  location: string, 
  priceRange: string, 
  listingType: string,
  sliderMaxBudget?: number,
  sliderIsRent?: boolean | null,
  sliderMinBudget?: number
): boolean {
  // 1. Search Keyword
  if (searchKeyword) {
    const kw = searchKeyword.toLowerCase().trim();
    if (kw) {
      const titleMatch = prop.title.toLowerCase().includes(kw);
      const locMatch = prop.location.toLowerCase().includes(kw);
      const bhkMatch = prop.bhk.toLowerCase().includes(kw);
      const typeMatch = (prop.listingType || "Sell").toLowerCase().includes(kw);
      const priceMatch = prop.price.toLowerCase().includes(kw);
      
      let buyTypeMatch = false;
      if (kw === "buy" || kw === "purchase" || kw === "sell") {
        buyTypeMatch = (prop.listingType || "Sell").toLowerCase() === "sell";
      }
      
      if (!titleMatch && !locMatch && !bhkMatch && !typeMatch && !priceMatch && !buyTypeMatch) {
         return false;
      }
    }
  }

  // 2. Listing Type
  const propType = prop.listingType || "Sell";
  if (listingType && listingType !== "All") {
    if (propType.toLowerCase() !== listingType.toLowerCase()) {
      return false;
    }
  }

  // 3. BHK Filter (Config/layout)
  if (bhk && bhk !== "All") {
    const cleanFilterBhk = bhk.toLowerCase().replace(/\s*flat|\s*apartment|\s*premium|\s*luxury/gi, '').trim();
    const cleanPropBhk = prop.bhk.toLowerCase().replace(/\s*flat|\s*apartment|\s*premium|\s*luxury/gi, '').trim();
    if (!cleanPropBhk.includes(cleanFilterBhk) && !cleanFilterBhk.includes(cleanPropBhk)) {
      return false;
    }
  }

  // 4. Location Filter (Neighborhood)
  if (location && location !== "All") {
    const cleanFilterLoc = location.toLowerCase().replace(/,?\s*pune/gi, '').trim();
    const cleanPropLoc = prop.location.toLowerCase().replace(/,?\s*pune/gi, '').trim();
    if (!cleanPropLoc.includes(cleanFilterLoc) && !cleanFilterLoc.includes(cleanPropLoc)) {
      return false;
    }
  }

  // 5. Price Range Filter (if select dropdown is used)
  if (priceRange && priceRange !== "All") {
    const norm = normalizePrice(prop.price, prop.listingType);
    const priceVal = norm.value;
    
    if (priceRange === "sell_under_90l") {
      if (norm.isRent || priceVal > 9000000 || priceVal === 0) return false;
    } else if (priceRange === "sell_90l_1.5c") {
      if (norm.isRent || priceVal < 9000000 || priceVal > 15000000) return false;
    } else if (priceRange === "sell_1.5c_2c") {
      if (norm.isRent || priceVal < 15000000 || priceVal > 20000000) return false;
    } else if (priceRange === "sell_above_2c") {
      if (norm.isRent || priceVal < 20000000) return false;
    } else if (priceRange === "rent_under_40k") {
      if (!norm.isRent || priceVal > 40000 || priceVal === 0) return false;
    } else if (priceRange === "rent_40k_50k") {
      if (!norm.isRent || priceVal < 40000 || priceVal > 50000) return false;
    } else if (priceRange === "rent_above_50k") {
      if (!norm.isRent || priceVal < 50000) return false;
    }
  }

  // 6. Slider Budget Filter
  if ((sliderMaxBudget !== undefined && sliderMaxBudget !== null) || (sliderMinBudget !== undefined && sliderMinBudget !== null)) {
    const norm = normalizePrice(prop.price, prop.listingType);
    const priceVal = norm.value;
    
    // Check if listing type matches listing category choice (rent/buy)
    if (sliderIsRent === true) {
      if (!norm.isRent) return false;
    } else if (sliderIsRent === false) {
      if (norm.isRent) return false;
    }

    // Check min limit bounds
    if (sliderMinBudget !== undefined && sliderMinBudget !== null && priceVal < sliderMinBudget) {
      return false;
    }

    // Check max limit bounds
    if (sliderMaxBudget !== undefined && sliderMaxBudget !== null && sliderMaxBudget !== Infinity && priceVal > sliderMaxBudget) {
      return false;
    }
  }

  return true;
}

// Render dynamic property gallery
async function renderPropertiesGrid(
  container: HTMLElement, 
  filters: { 
    searchKeyword?: string; 
    bhk?: string; 
    location?: string; 
    priceRange?: string; 
    listingType?: string; 
    sliderMaxBudget?: number;
    sliderIsRent?: boolean | null;
    sliderMinBudget?: number;
  } = {}
) {
  container.innerHTML = `
    <div class="col-span-full text-center py-12">
      <div class="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#E53E3E] border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" role="status">
        <span class="sr-only">Loading Properties...</span>
      </div>
      <p class="mt-4 text-[#9CA3AF] font-mono">Retrieving premium real estate showcases...</p>
    </div>
  `;

  try {
    const items = await fetchProperties();
    
    // Apply client-side filters
    const search = filters.searchKeyword || "";
    const bhk = filters.bhk || "All";
    const loc = filters.location || "All";
    const price = filters.priceRange || "All";
    const type = filters.listingType || "All";
    const sliderMaxBudget = filters.sliderMaxBudget;
    const sliderIsRent = filters.sliderIsRent;
    const sliderMinBudget = filters.sliderMinBudget;
    
    const filteredItems = items.filter(prop => 
      matchesFilters(prop, search, bhk, loc, price, type, sliderMaxBudget, sliderIsRent, sliderMinBudget)
    );

    container.innerHTML = ""; // Clear loader

    if (filteredItems.length === 0) {
      container.innerHTML = `
        <div class="col-span-full text-center py-16 bg-[#1D2026] rounded-2xl p-8 border border-dashed border-[rgba(255,255,255,0.08)]">
          <p class="text-[#9CA3AF] font-mono text-lg font-medium">No properties match your filter criteria.</p>
          <p class="text-xs text-[#9CA3AF] mt-2">Try relaxing your search terms or selecting 'All' filters.</p>
          <button id="reset-inner-filters" class="mt-5 inline-block px-6 py-2 rounded-lg text-xs bg-[#E53E3E] text-white hover:bg-[#C53030] transition-colors cursor-pointer font-bold">
            Reset Filters
          </button>
        </div>
      `;
      const innerResetBtn = document.getElementById('reset-inner-filters');
      if (innerResetBtn) {
        innerResetBtn.addEventListener('click', () => {
          const propResetBtn = document.getElementById('prop-filter-reset');
          if (propResetBtn) {
            propResetBtn.click();
          } else {
            const homeResetBtn = document.getElementById('home-filter-reset');
            if (homeResetBtn) homeResetBtn.click();
          }
        });
      }
      return;
    }

    filteredItems.forEach(prop => {
      const embedUrl = getInstagramEmbedUrl(prop.instagramUrl);
      const card = document.createElement('div');
      card.className = "glass-panel rounded-2xl overflow-hidden bg-card-mobile-fix border-glass-mobile-fix flex flex-col transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl glow-red";
      
      const type = prop.listingType || "Sell";
      const typeColorBg = type === "Rent" ? "bg-[#0A84FF]" : "bg-[#E53E3E]";

      card.innerHTML = `
        <!-- Walkthrough Header Info -->
        <div class="relative w-full h-[370px] sm:h-[420px] md:h-[450px] overflow-hidden bg-[#0E0F11]">
          <iframe 
            src="${embedUrl}" 
            class="absolute top-[-56px] left-0 w-full h-[calc(100%+165px)] border-0 rounded-t-2xl" 
            scrolling="no" 
            allowtransparency="true" 
            allow="encrypted-media"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
            loading="lazy"
            referrerpolicy="no-referrer">
          </iframe>
          <!-- Listing Type Tag -->
          <div class="absolute top-4 left-4 z-20 bg-[#121214]/85 backdrop-blur-md text-[#FFFFFF] text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border border-solid border-[rgba(255,255,255,0.08)] shadow-lg flex items-center gap-1.5">
            <span class="h-2 w-2 rounded-full ${typeColorBg}"></span>
            For ${type === "Rent" ? "Rent" : "Sell"}
          </div>
        </div>
        
        <!-- Info Panel (Premium Overlap Shift) -->
        <div class="relative z-10 -mt-12 p-4 pb-2.5 sm:p-5 sm:pb-3 flex-1 flex flex-col bg-[#1E2229] rounded-t-2xl border-t border-solid border-[rgba(255,255,255,0.06)] shadow-[0_-8px_20px_rgba(0,0,0,0.4)]">
          <div class="flex-1 flex flex-col justify-start">
            <div>
              <div class="flex justify-between items-start gap-2">
                <h3 class="text-lg sm:text-xl font-bold text-[#FFFFFF] tracking-tight line-clamp-1">${prop.title}</h3>
                <span class="bg-[#E53E3E] text-[#FFFFFF] text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded whitespace-nowrap">
                  ${prop.price}
                </span>
              </div>
              
              <p class="text-[#9CA3AF] text-xs sm:text-sm mt-1.5 flex items-center gap-1.5 font-sans">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-[#0A84FF] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
                <span class="line-clamp-1">${prop.location}</span>
              </p>

              <div class="mt-2.5 pt-2.5 border-t border-solid border-[rgba(255,255,255,0.08)] flex flex-wrap gap-2">
                <span class="bg-[#1E2229] border border-solid border-[rgba(255,255,255,0.1)] text-[11px] text-[#9CA3AF] font-mono px-2.5 py-1 rounded-md">
                  ${prop.bhk}
                </span>
                <span class="bg-[#1E2229] border border-solid border-[rgba(255,255,255,0.1)] text-[11px] text-[#9CA3AF] font-mono px-2.5 py-1 rounded-md flex items-center gap-1">
                  <span class="h-1.5 w-1.5 rounded-full bg-[#25D366]"></span> 5-Star Guided Tour
                </span>
              </div>
            </div>
            
            <div class="mt-3 flex gap-2">
              <a 
                href="https://wa.me/919793199441?text=Hello%20Bardhaman%20Property,%20I%20am%20interested%20in%20inspecting%20the%20property:%20${encodeURIComponent(prop.title)}%20(${encodeURIComponent(prop.price)})" 
                target="_blank" 
                referrerpolicy="no-referrer"
                class="flex-1 text-center py-2 rounded-lg flex items-center justify-center gap-1.5 text-xs sm:text-sm px-3 text-[#FFFFFF] font-semibold transition-all duration-200 hover:scale-[1.03] shadow-[0_4px_12px_rgba(37,211,102,0.3)]"
                style="background-color: #25D366 !important;"
              >
                <svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg">
                  <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L3 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/>
                </svg>
                Inquire WhatsApp
              </a>
              <a 
                href="contact.html" 
                class="glass-button-secondary text-xs sm:text-sm px-3 sm:px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Contact Agent
              </a>
            </div>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (error) {
    console.error("Critical rendering pipeline issue. Check code validations.", error);
  }
}

// Render dynamic recent properties gallery (Limit to 3)
async function renderRecentPropertiesGrid(
  container: HTMLElement, 
  filters: { 
    searchKeyword?: string; 
    bhk?: string; 
    location?: string; 
    priceRange?: string; 
    listingType?: string; 
    sliderMaxBudget?: number;
    sliderIsRent?: boolean | null;
    sliderMinBudget?: number;
  } = {}
) {
  container.innerHTML = `
    <div class="col-span-full text-center py-12">
      <div class="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#E53E3E] border-r-transparent align-[-0.125em] motion-reduce:animate-[spin_1.5s_linear_infinite]" role="status">
        <span class="sr-only">Loading Properties...</span>
      </div>
      <p class="mt-4 text-[#9CA3AF] font-mono">Retrieving premium real estate showcases...</p>
    </div>
  `;

  try {
    const items = await fetchProperties();
    
    // Apply client-side filters
    const search = filters.searchKeyword || "";
    const bhk = filters.bhk || "All";
    const loc = filters.location || "All";
    const price = filters.priceRange || "All";
    const type = filters.listingType || "All";
    const sliderMaxBudget = filters.sliderMaxBudget;
    const sliderIsRent = filters.sliderIsRent;
    const sliderMinBudget = filters.sliderMinBudget;
    
    const filteredItems = items.filter(prop => 
      matchesFilters(prop, search, bhk, loc, price, type, sliderMaxBudget, sliderIsRent, sliderMinBudget)
    );

    container.innerHTML = ""; // Clear loader

    if (filteredItems.length === 0) {
      container.innerHTML = `
        <div class="col-span-full text-center py-12 p-8 bg-[#1D2026] rounded-2xl border border-dashed border-[rgba(255,255,255,0.08)]">
          <p class="text-[#9CA3AF] font-mono text-medium font-bold">No matching verified walkthrough deals found.</p>
          <button id="reset-recent-inner-filters" class="mt-4 inline-block px-5 py-2 rounded-lg text-xs bg-[#E53E3E] text-white hover:bg-[#C53030] transition-colors cursor-pointer font-bold">
            Reset Filters
          </button>
        </div>
      `;
      const innerResetBtn = document.getElementById('reset-recent-inner-filters');
      if (innerResetBtn) {
        innerResetBtn.addEventListener('click', () => {
          const homeResetBtn = document.getElementById('home-filter-reset');
          if (homeResetBtn) homeResetBtn.click();
        });
      }
      return;
    }

    // Slice to the first 3 (newest additions)
    const recentItems = filteredItems.slice(0, 3);

    recentItems.forEach(prop => {
      const embedUrl = getInstagramEmbedUrl(prop.instagramUrl);
      const card = document.createElement('div');
      card.className = "glass-panel rounded-2xl overflow-hidden bg-card-mobile-fix border-glass-mobile-fix flex flex-col transition-all duration-300 hover:scale-[1.02] hover:shadow-2xl glow-red";
      
      const type = prop.listingType || "Sell";
      const typeColorBg = type === "Rent" ? "bg-[#0A84FF]" : "bg-[#E53E3E]";

      card.innerHTML = `
        <!-- Walkthrough Header Info -->
        <div class="relative w-full h-[370px] sm:h-[420px] md:h-[450px] overflow-hidden bg-[#0E0F11]">
          <iframe 
            src="${embedUrl}" 
            class="absolute top-[-56px] left-0 w-full h-[calc(100%+165px)] border-0 rounded-t-2xl" 
            scrolling="no" 
            allowtransparency="true" 
            allow="encrypted-media"
            sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"
            loading="lazy"
            referrerpolicy="no-referrer">
          </iframe>
          <!-- Listing Type Tag -->
          <div class="absolute top-4 left-4 z-20 bg-[#121214]/85 backdrop-blur-md text-[#FFFFFF] text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 rounded-md border border-solid border-[rgba(255,255,255,0.08)] shadow-lg flex items-center gap-1.5">
            <span class="h-2 w-2 rounded-full ${typeColorBg}"></span>
            For ${type === "Rent" ? "Rent" : "Sell"}
          </div>
        </div>
        
        <!-- Info Panel (Premium Overlap Shift) -->
        <div class="relative z-10 -mt-12 p-4 pb-2.5 sm:p-5 sm:pb-3 flex-1 flex flex-col bg-[#1E2229] rounded-t-2xl border-t border-solid border-[rgba(255,255,255,0.06)] shadow-[0_-8px_20px_rgba(0,0,0,0.4)]">
          <div class="flex-1 flex flex-col justify-start">
            <div>
              <div class="flex justify-between items-start gap-2">
                <h3 class="text-lg sm:text-xl font-bold text-[#FFFFFF] tracking-tight line-clamp-1">${prop.title}</h3>
                <span class="bg-[#E53E3E] text-[#FFFFFF] text-xs font-bold uppercase tracking-wider px-2.5 py-1 rounded whitespace-nowrap">
                  ${prop.price}
                </span>
              </div>
              
              <p class="text-[#9CA3AF] text-xs sm:text-sm mt-1.5 flex items-center gap-1.5 font-sans">
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5 text-[#0A84FF] shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z"/>
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z"/>
                </svg>
                <span class="line-clamp-1">${prop.location}</span>
              </p>

              <div class="mt-2.5 pt-2.5 border-t border-solid border-[rgba(255,255,255,0.08)] flex flex-wrap gap-2">
                <span class="bg-[#1E2229] border border-solid border-[rgba(255,255,255,0.1)] text-[11px] text-[#9CA3AF] font-mono px-2.5 py-1 rounded-md">
                  ${prop.bhk}
                </span>
                <span class="bg-[#1E2229] border border-solid border-[rgba(255,255,255,0.1)] text-[11px] text-[#9CA3AF] font-mono px-2.5 py-1 rounded-md flex items-center gap-1">
                  <span class="h-1.5 w-1.5 rounded-full bg-[#25D366]"></span> 5-Star Guided Tour
                </span>
              </div>
            </div>
            
            <div class="mt-3 flex gap-2">
              <a 
                href="https://wa.me/919793199441?text=Hello%20Bardhaman%20Property,%20I%20am%20interested%20in%20inspecting%20the%20property:%20${encodeURIComponent(prop.title)}%20(${encodeURIComponent(prop.price)})" 
                target="_blank" 
                referrerpolicy="no-referrer"
                class="flex-1 text-center py-2 rounded-lg flex items-center justify-center gap-1.5 text-xs sm:text-sm px-3 text-[#FFFFFF] font-semibold transition-all duration-200 hover:scale-[1.03] shadow-[0_4px_12px_rgba(37,211,102,0.3)]"
                style="background-color: #25D366 !important;"
              >
                <svg class="h-3.5 w-3.5" fill="currentColor" viewBox="0 0 448 512" xmlns="http://www.w3.org/2000/svg">
                  <path d="M380.9 97.1C339 55.1 283.2 32 223.9 32c-122.4 0-222 99.6-222 222 0 39.1 10.2 77.3 29.6 111L3 480l117.7-30.9c32.4 17.7 68.9 27 106.1 27h.1c122.3 0 224.1-99.6 224.1-222 0-59.3-25.2-115-67.1-157zm-157 341.6c-33.2 0-65.7-8.9-94-25.7l-6.7-4-69.8 18.3L72 359.2l-4.4-7c-18.5-29.4-28.2-63.3-28.2-98.2 0-101.7 82.8-184.5 184.6-184.5 49.3 0 95.6 19.2 130.4 54.1 34.8 34.9 56.2 81.2 56.1 130.5 0 101.8-84.9 184.6-186.6 184.6zm101.2-138.2c-5.5-2.8-32.8-16.2-37.9-18-5.1-1.9-8.8-2.8-12.5 2.8-3.7 5.6-14.3 18-17.6 21.8-3.2 3.7-6.5 4.2-12 1.4-32.6-16.3-54-29.1-75.5-66-5.7-9.8 5.7-9.1 16.3-30.3 1.8-3.7.9-6.9-.5-9.7-1.4-2.8-12.5-30.1-17.1-41.2-4.5-10.8-9.1-9.3-12.5-9.5-3.2-.2-6.9-.2-10.6-.2-3.7 0-9.7 1.4-14.8 6.9-5.1 5.6-19.4 19-19.4 46.3 0 27.3 19.9 53.7 22.6 57.4 2.8 3.7 39.1 59.7 94.8 83.8 35.2 15.2 49 16.5 66.6 13.9 10.7-1.6 32.8-13.4 37.4-26.4 4.6-13 4.6-24.1 3.2-26.4-1.3-2.5-5-3.9-10.5-6.6z"/>
                </svg>
                Inquire WhatsApp
              </a>
              <a 
                href="contact.html" 
                class="glass-button-secondary text-xs sm:text-sm px-3 sm:px-4 py-2 rounded-lg flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.94.725l.548 2.2a1 1 0 01-.321.988l-1.305.98a10.582 10.582 0 004.872 4.872l.98-1.305a1 1 0 01.988-.321l2.2.548a1 1 0 01.725.94V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                Contact Agent
              </a>
            </div>
          </div>
        </div>
      `;
      container.appendChild(card);
    });
  } catch (error) {
    console.error("Critical rendering pipeline issue. Check code validations.", error);
  }
}

// Setup Admin form & property showcase list in admin.html
async function setupAdminPanel(form: HTMLFormElement, listContainer: HTMLElement) {
  let editingPropertyId: string | null = null;
  let editingPropertyCreatedAt: number | undefined = undefined;

  const headingEl = document.getElementById('admin-form-heading');
  const subheadingEl = document.getElementById('admin-form-subheading');
  const submitBtn = document.getElementById('submit-property-btn') as HTMLButtonElement;
  const cancelBtn = document.getElementById('cancel-edit-btn') as HTMLButtonElement;

  const titleInput = document.getElementById('property-title') as HTMLInputElement;
  const bhkInput = document.getElementById('property-bhk') as HTMLSelectElement;
  const typeInput = document.getElementById('property-type') as HTMLSelectElement;
  const locationSelect = document.getElementById('property-location-select') as HTMLSelectElement;
  const customLocationContainer = document.getElementById('custom-location-container') as HTMLElement;
  const locationInput = document.getElementById('property-location') as HTMLInputElement;
  const priceInput = document.getElementById('property-price') as HTMLInputElement;
  const reelInput = document.getElementById('property-reel') as HTMLInputElement;

  // Helper to style empty selects like input placeholders
  function styleSelectPlaceholder(selectEl: HTMLSelectElement) {
    if (!selectEl) return;
    if (selectEl.value === "") {
      selectEl.style.color = "rgba(255, 255, 255, 0.35)";
    } else {
      selectEl.style.color = "#FFFFFF";
    }
  }

  // Sync selection to target location text input field
  if (locationSelect && customLocationContainer && locationInput) {
    styleSelectPlaceholder(locationSelect);
    locationSelect.addEventListener('change', () => {
      styleSelectPlaceholder(locationSelect);
      if (locationSelect.value === 'custom') {
        customLocationContainer.classList.remove('hidden');
        locationInput.required = true;
        locationInput.focus();
      } else {
        customLocationContainer.classList.add('hidden');
        locationInput.required = false;
        locationInput.value = locationSelect.value;
      }
    });
  }

  if (typeInput) {
    styleSelectPlaceholder(typeInput);
    typeInput.addEventListener('change', () => {
      styleSelectPlaceholder(typeInput);
    });
  }

  if (bhkInput) {
    styleSelectPlaceholder(bhkInput);
    bhkInput.addEventListener('change', () => {
      styleSelectPlaceholder(bhkInput);
    });
  }

  function resetFormToCreateMode() {
    editingPropertyId = null;
    editingPropertyCreatedAt = undefined;
    form.reset();
    if (customLocationContainer) {
      customLocationContainer.classList.add('hidden');
    }
    if (locationInput) {
      locationInput.required = false;
    }
    if (locationSelect) styleSelectPlaceholder(locationSelect);
    if (typeInput) styleSelectPlaceholder(typeInput);
    if (bhkInput) styleSelectPlaceholder(bhkInput);
    
    if (headingEl) headingEl.innerText = "Create Listing Showcase";
    if (subheadingEl) subheadingEl.innerText = "Upload new walkthrough videos. Changes are instantaneous and propagate directly to properties.html.";
    if (submitBtn) {
      submitBtn.innerText = "Publish Property Showcase";
      submitBtn.disabled = false;
    }
    if (cancelBtn) {
      cancelBtn.classList.add('hidden');
    }
  }

  const onEditCallback = (prop: Property) => {
    editingPropertyId = prop.id || null;
    editingPropertyCreatedAt = prop.createdAt;

    // Populate the form fields
    if (titleInput) titleInput.value = prop.title;
    if (bhkInput) {
      let bhkMatched = false;
      for (let i = 0; i < bhkInput.options.length; i++) {
        if (bhkInput.options[i].value === prop.bhk) {
          bhkMatched = true;
          break;
        }
      }
      if (!bhkMatched && prop.bhk) {
        const tempOpt = document.createElement('option');
        tempOpt.value = prop.bhk;
        tempOpt.text = prop.bhk;
        bhkInput.appendChild(tempOpt);
      }
      bhkInput.value = prop.bhk;
    }
    if (typeInput) typeInput.value = prop.listingType || "Sell";
    if (priceInput) priceInput.value = prop.price;
    if (reelInput) reelInput.value = prop.instagramUrl;

    if (locationSelect) {
      // Find if location matches any option in Select dropdown
      let matched = false;
      for (let i = 0; i < locationSelect.options.length; i++) {
        if (locationSelect.options[i].value === prop.location) {
          matched = true;
          break;
        }
      }

      if (matched) {
        locationSelect.value = prop.location;
        if (customLocationContainer) customLocationContainer.classList.add('hidden');
        if (locationInput) {
          locationInput.value = prop.location;
          locationInput.required = false;
        }
      } else {
        locationSelect.value = "custom";
        if (customLocationContainer) customLocationContainer.classList.remove('hidden');
        if (locationInput) {
          locationInput.value = prop.location;
          locationInput.required = true;
        }
      }
    }

    if (locationSelect) styleSelectPlaceholder(locationSelect);
    if (typeInput) styleSelectPlaceholder(typeInput);
    if (bhkInput) styleSelectPlaceholder(bhkInput);

    // Scroll back to form in mobile/desktop
    form.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Update Form state to Edit mode
    if (headingEl) headingEl.innerText = "Edit Listing Showcase";
    if (subheadingEl) subheadingEl.innerText = `Modifying tour details for "${prop.title}".`;
    if (submitBtn) {
      submitBtn.innerText = "Save Property Changes";
    }
    if (cancelBtn) {
      cancelBtn.classList.remove('hidden');
    }
  };

  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      resetFormToCreateMode();
    });
  }

  // 1. Setup Submit Listener
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.innerText = editingPropertyId ? "Saving Changes..." : "Processing Upload...";
    }

    const titleValue = titleInput ? titleInput.value.trim() : "";
    const bhkValue = bhkInput ? bhkInput.value : "";
    const typeValue = typeInput ? typeInput.value : "Sell";
    
    // Resolve location value from either preset select or custom input text
    const selectValue = locationSelect ? locationSelect.value : "";
    let locationValue = "";
    if (selectValue === 'custom') {
      locationValue = locationInput ? locationInput.value.trim() : "";
    } else {
      locationValue = selectValue;
    }

    const priceValue = priceInput ? priceInput.value.trim() : "";
    const reelValue = reelInput ? reelInput.value.trim() : "";

    if (!titleValue || !locationValue || !priceValue || !reelValue) {
      alert("Please populate all necessary input fields!");
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = editingPropertyId ? "Save Property Changes" : "Publish Property Showcase";
      }
      return;
    }

    try {
      let success = false;
      if (editingPropertyId) {
        success = await updateProperty(editingPropertyId, {
          title: titleValue,
          bhk: bhkValue,
          location: locationValue,
          price: priceValue,
          instagramUrl: reelValue,
          listingType: typeValue
        }, editingPropertyCreatedAt);
      } else {
        success = await uploadProperty({
          title: titleValue,
          bhk: bhkValue,
          location: locationValue,
          price: priceValue,
          instagramUrl: reelValue,
          listingType: typeValue
        });
      }

      if (success) {
        const isEditingMode = !!editingPropertyId;
        resetFormToCreateMode();
        
        // Render updated list with the edit callback preserved
        await renderAdminList(listContainer, onEditCallback);

        // Show local floating alert
        const alertEl = document.createElement('div');
        alertEl.className = "fixed top-5 right-5 bg-[#25D366] text-white px-6 py-3 rounded-lg font-bold shadow-2xl z-[9999]";
        alertEl.innerText = isEditingMode ? "✓ Property Tour Changes Saved!" : "✓ Property Tour Published Successfully!";
        document.body.appendChild(alertEl);
        setTimeout(() => alertEl.remove(), 4000);
      }
    } catch (err) {
      console.error(err);
      alert(editingPropertyId ? "Error updating property." : "Error adding property.");
    } finally {
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerText = editingPropertyId ? "Save Property Changes" : "Publish Property Showcase";
      }
    }
  });

  // 2. Render list of current items so they can delete or edit them
  await renderAdminList(listContainer, onEditCallback);
}

// Render property list inside Admin panel with Edit and Delete functionality
async function renderAdminList(container: HTMLElement, onEditClick?: (prop: Property) => void) {
  container.innerHTML = `
    <div class="text-center py-6">
      <p class="text-[#9CA3AF] font-mono animate-pulse">Loading active properties catalogue...</p>
    </div>
  `;

  try {
    const items = await fetchProperties();
    container.innerHTML = "";

    if (items.length === 0) {
      container.innerHTML = `
        <div class="text-center py-6">
          <p class="text-[#9CA3AF]">No active listings found. Seed standard data is running.</p>
        </div>
      `;
      return;
    }

    items.forEach(prop => {
      const isDefault = prop.id?.startsWith('def-');
      const itemEl = document.createElement('div');
      itemEl.className = "flex flex-col xl:flex-row xl:items-center justify-between p-4 bg-card-mobile-fix border border-solid border-[rgba(255,255,255,0.06)] rounded-lg gap-4 glow-blue";
      
      const type = prop.listingType || "Sell";
      const typeColorBg = type === "Rent" ? "bg-[#0A84FF]/20 text-[#0A84FF]" : "bg-[#E53E3E]/20 text-[#E53E3E]";

      itemEl.innerHTML = `
        <div class="flex-1 min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h4 class="font-bold text-white truncate max-w-xs sm:max-w-md">${prop.title}</h4>
            <span class="text-xs bg-[rgba(10,132,255,0.15)] text-[#0A84FF] px-2 py-0.5 rounded whitespace-nowrap">${prop.price}</span>
            <span class="text-[10px] ${typeColorBg} px-2 py-0.5 rounded font-bold uppercase tracking-wider">${type}</span>
            ${isDefault ? '<span class="text-[10px] bg-amber-500/10 text-amber-500 px-1.5 py-0.5 rounded font-mono">Sample</span>' : ''}
          </div>
          <p class="text-sm text-[#9CA3AF] mt-1">${prop.bhk} • ${prop.location}</p>
          <a href="${prop.instagramUrl}" target="_blank" class="text-xs text-[#0A84FF] underline font-mono truncate block max-w-sm mt-1">${prop.instagramUrl}</a>
        </div>
        <div class="flex items-center gap-2 mt-2 xl:mt-0 shrink-0">
          <button 
            data-id="${prop.id}" 
            class="edit-property-btn px-3 sm:px-4 py-2 bg-[#0A84FF] hover:bg-[#0070E0] text-white text-xs font-bold rounded-lg transition-all duration-200 flex items-center gap-1 cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            Edit
          </button>
          <button 
            data-id="${prop.id}" 
            class="delete-property-btn px-3 sm:px-4 py-2 bg-[#E53E3E] hover:bg-[#C53030] text-white text-xs font-bold rounded-lg transition-all duration-200 flex items-center gap-1 cursor-pointer"
          >
            <svg xmlns="http://www.w3.org/2000/svg" class="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path fill-rule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clip-rule="evenodd" />
            </svg>
            Delete
          </button>
        </div>
      `;
      container.appendChild(itemEl);
    });

    // Add Edit Listeners
    if (onEditClick) {
      container.querySelectorAll('.edit-property-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const id = (e.currentTarget as HTMLButtonElement).getAttribute('data-id');
          if (id) {
            const found = items.find(item => item.id === id);
            if (found) {
              onEditClick(found);
            }
          }
        });
      });
    }

    // Add Delete Listeners
    container.querySelectorAll('.delete-property-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const id = (e.currentTarget as HTMLButtonElement).getAttribute('data-id');
        if (id) {
          if (confirm("Are you sure you want to remove this property walkthrough from the client showcase?")) {
            const btnEl = e.currentTarget as HTMLButtonElement;
            btnEl.disabled = true;
            btnEl.innerHTML = `Deleting...`;
            
            const success = await deleteProperty(id);
            if (success) {
              await renderAdminList(container, onEditClick);
            } else {
              btnEl.disabled = false;
              btnEl.innerHTML = `Delete`;
              alert("Error deleting the property. Please confirm permissions.");
            }
          }
        }
      });
    });

  } catch (error) {
    console.error("Pipeline failure in compiling Admin view metadata.", error);
  }
}
