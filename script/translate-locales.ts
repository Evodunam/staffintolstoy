#!/usr/bin/env tsx
/**
 * Translation script to translate all locale files from English
 * Uses Google Cloud Translate API
 * 
 * Usage: npm run i18n:translate
 * 
 * This script:
 * 1. Reads en.json as the source
 * 2. Translates all string values to es, fr, pt, zh using Google Cloud Translate API
 * 3. Preserves JSON structure and keys
 * 4. Handles nested objects recursively
 * 5. Preserves interpolation variables like {{variable}}
 * 
 * Environment variables:
 * - GOOGLE_APPLICATION_CREDENTIALS: Path to service account JSON file (optional)
 * - GOOGLE_CLOUD_PROJECT: Google Cloud project ID (optional, auto-detected)
 * - GOOGLE_TRANSLATE_API_KEY: API key for Translate API (alternative to service account)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { v2 as translateV2 } from '@google-cloud/translate';

// Language codes mapping for Google Cloud Translate
const LANGUAGES = {
  es: { name: 'Spanish', code: 'es' },
  fr: { name: 'French', code: 'fr' },
  pt: { name: 'Portuguese', code: 'pt' },
  zh: { name: 'Chinese (Simplified)', code: 'zh-CN' },
} as const;

type LanguageCode = keyof typeof LANGUAGES;

// Initialize Google Cloud Translate client
let translateClient: translateV2.Translate | null = null;

async function initializeTranslateClient() {
  if (translateClient) return translateClient;

  try {
    // Initialize with credentials
    // Google Cloud SDK will automatically use:
    // 1. GOOGLE_APPLICATION_CREDENTIALS env var (service account JSON)
    // 2. gcloud auth application-default login credentials
    // 3. Metadata service (if running on GCP)
    // 4. API key (if provided)
    const config: any = {};
    
    // Check for service account JSON file path
    const defaultServiceAccountPath = 'c:\\Users\\cairl\\Desktop\\Imp stuff\\1801 Cleveland ave\\Permits\\Submission PDF (1)\\tolstoy-staffing-23032-91927f0b4a3e.json';
    const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || 
      (existsSync(defaultServiceAccountPath) ? defaultServiceAccountPath : null);
    
    // Prefer API key if available (simpler for most use cases)
    if (process.env.GOOGLE_TRANSLATE_API_KEY) {
      config.key = process.env.GOOGLE_TRANSLATE_API_KEY;
      console.log('   Using API key authentication');
    } else if (serviceAccountPath && existsSync(serviceAccountPath)) {
      // Try to use service account JSON file
      try {
        const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'));
        config.projectId = serviceAccount.project_id;
        config.keyFilename = serviceAccountPath;
        console.log(`   Using service account credentials from: ${serviceAccountPath}`);
      } catch (error: any) {
        console.warn(`   Could not load service account from ${serviceAccountPath}: ${error.message}`);
        console.log('   Falling back to default application credentials');
      }
    } else {
      console.log('   Using default application credentials');
      console.log('   Note: Set GOOGLE_APPLICATION_CREDENTIALS or run: gcloud auth application-default login');
    }
    
    if (process.env.GOOGLE_CLOUD_PROJECT) {
      config.projectId = process.env.GOOGLE_CLOUD_PROJECT;
    }
    
    translateClient = new translateV2.Translate(config);

    // Test the connection with a simple translation
    try {
      await translateClient.translate('test', 'es');
      console.log('✅ Google Cloud Translate client initialized and tested');
    } catch (testError: any) {
      if (testError.message?.includes('invalid_grant') || testError.message?.includes('reauth')) {
        console.error('\n⚠️  Authentication error detected. Your credentials may need to be refreshed.');
        console.error('   Try one of these solutions:');
        console.error('   1. Re-authenticate: gcloud auth application-default login');
        console.error('   2. Use API key: Set GOOGLE_TRANSLATE_API_KEY environment variable');
        console.error('   3. Use service account: Set GOOGLE_APPLICATION_CREDENTIALS to your JSON file path');
        throw new Error('Authentication failed. Please refresh your credentials.');
      }
      throw testError;
    }
    
    return translateClient;
  } catch (error: any) {
    console.error('❌ Failed to initialize Google Cloud Translate:', error.message);
    console.error('\n📋 Setup instructions:');
    console.error('   1. Install the package: npm install @google-cloud/translate');
    console.error('   2. Set up authentication (choose one):');
    console.error('      a) API Key (recommended): Set GOOGLE_TRANSLATE_API_KEY environment variable');
    console.error('      b) Service Account: Set GOOGLE_APPLICATION_CREDENTIALS to your service account JSON file path');
    console.error('      c) Default credentials: Run: gcloud auth application-default login');
    console.error('   3. Enable Cloud Translation API in your Google Cloud project');
    console.error('   4. Get API key from: https://console.cloud.google.com/apis/credentials');
    throw error;
  }
}

// Translate text using Google Cloud Translate API
async function translateText(text: string, targetLang: LanguageCode): Promise<string> {
  // Skip translation for:
  // - Empty strings
  // - Brand names
  if (!text || text.trim() === '' || text === 'Tolstoy Staffing') {
    return text;
  }

  // Preserve interpolation variables like {{variable}}
  const interpolationMatches = text.match(/\{\{(\w+)\}\}/g);
  const hasInterpolation = !!interpolationMatches;
  
  try {
    const client = await initializeTranslateClient();
    const targetLanguageCode = LANGUAGES[targetLang].code;
    
    // Translate the text
    const [translation] = await client.translate(text, targetLanguageCode);
    
    if (!translation) {
      console.warn(`Translation returned empty for: "${text.substring(0, 50)}..."`);
      return text;
    }

    let translated = translation;

    // Preserve interpolation variables if they were in the original
    if (hasInterpolation && interpolationMatches) {
      interpolationMatches.forEach(match => {
        // Ensure the variable is preserved in translation
        // Google Translate might translate the variable name, so we restore it
        const variableName = match.match(/\{\{(\w+)\}\}/)?.[1];
        if (variableName) {
          // Replace any translated version of the variable with the original
          // This handles cases where Google Translate changes {{variable}} to something else
          const translatedVariablePattern = new RegExp(`\\{\\{[^}]*${variableName}[^}]*\\}\\}`, 'gi');
          if (!translated.includes(match)) {
            // Try to find and replace any variation
            translated = translated.replace(translatedVariablePattern, match);
            // If still not found, append it (fallback)
            if (!translated.includes(match)) {
              // Find the position where it should be (usually where the original was)
              const originalIndex = text.indexOf(match);
              if (originalIndex !== -1) {
                // Try to preserve position by finding similar context
                translated = translated + ' ' + match;
              }
            }
          }
        }
      });
    }
    
    return translated;
  } catch (error: any) {
    // Handle authentication errors
    if (error.message?.includes('invalid_grant') || error.message?.includes('reauth')) {
      console.error('\n❌ Authentication error. Please refresh your Google Cloud credentials.');
      console.error('   Run: gcloud auth application-default login');
      console.error('   Or set GOOGLE_TRANSLATE_API_KEY environment variable');
      throw error; // Re-throw to stop the process
    }
    console.warn(`Translation error for "${text.substring(0, 50)}...":`, error.message);
    return text; // Return original on error
  }
}

// Batch translate multiple texts for efficiency
async function translateBatch(texts: string[], targetLang: LanguageCode): Promise<string[]> {
  if (texts.length === 0) return [];
  
  try {
    const client = await initializeTranslateClient();
    const targetLanguageCode = LANGUAGES[targetLang].code;
    
    // Google Cloud Translate supports batch translation
    const [translations] = await client.translate(texts, targetLanguageCode);
    
    // Handle both single and array responses
    const results = Array.isArray(translations) ? translations : [translations];
    
    // Preserve interpolation variables for each translation
    return results.map((translated: string, index: number) => {
      const original = texts[index];
      const interpolationMatches = original.match(/\{\{(\w+)\}\}/g);
      
      if (interpolationMatches) {
        interpolationMatches.forEach(match => {
          if (!translated.includes(match)) {
            // Restore interpolation variables
            const variableName = match.match(/\{\{(\w+)\}\}/)?.[1];
            if (variableName) {
              const translatedVariablePattern = new RegExp(`\\{\\{[^}]*${variableName}[^}]*\\}\\}`, 'gi');
              translated = translated.replace(translatedVariablePattern, match);
              if (!translated.includes(match)) {
                translated = translated + ' ' + match;
              }
            }
          }
        });
      }
      
      return translated || original;
    });
    } catch (error: any) {
      // Handle authentication errors
      if (error.message?.includes('invalid_grant') || error.message?.includes('reauth')) {
        console.error('\n❌ Authentication error in batch translation. Please refresh your credentials.');
        throw error; // Re-throw to stop the process
      }
      console.warn(`Batch translation error:`, error.message);
      // Fallback to individual translations
      return Promise.all(texts.map(text => translateText(text, targetLang)));
    }
}

// Collect all strings from an object for batch translation
function collectStrings(obj: any, strings: string[] = [], paths: string[] = []): { strings: string[]; paths: string[] } {
  if (typeof obj === 'string') {
    // Skip empty strings and brand names
    if (obj && obj.trim() !== '' && obj !== 'Tolstoy Staffing') {
      strings.push(obj);
      paths.push(paths.join('.'));
    }
  } else if (Array.isArray(obj)) {
    obj.forEach((item, index) => {
      collectStrings(item, strings, [...paths, `[${index}]`]);
    });
  } else if (obj !== null && typeof obj === 'object') {
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        collectStrings(obj[key], strings, [...paths, key]);
      }
    }
  }
  return { strings, paths };
}

// Apply translated strings back to object structure
function applyTranslations(obj: any, translations: Map<string, string>, currentPath: string[] = []): any {
  if (typeof obj === 'string') {
    const pathKey = currentPath.join('.');
    return translations.get(pathKey) || obj;
  } else if (Array.isArray(obj)) {
    return obj.map((item, index) => applyTranslations(item, translations, [...currentPath, `[${index}]`]));
  } else if (obj !== null && typeof obj === 'object') {
    const translated: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        translated[key] = applyTranslations(obj[key], translations, [...currentPath, key]);
      }
    }
    return translated;
  } else {
    return obj;
  }
}

// Recursively translate all string values in an object
async function translateObject(
  obj: any,
  targetLang: LanguageCode,
  path: string = '',
  batchSize: number = 100
): Promise<any> {
  // Collect all strings for batch translation
  const { strings, paths } = collectStrings(obj);
  
  if (strings.length === 0) {
    return obj;
  }

  console.log(`   Translating ${strings.length} strings in batches of ${batchSize}...`);
  
  // Translate in batches
  const translations = new Map<string, string>();
  for (let i = 0; i < strings.length; i += batchSize) {
    const batch = strings.slice(i, i + batchSize);
    const batchPaths = paths.slice(i, i + batchSize);
    
    try {
      const translatedBatch = await translateBatch(batch, targetLang);
      
      // Map translations back to paths
      batch.forEach((original, index) => {
        const pathKey = batchPaths[index];
        translations.set(pathKey, translatedBatch[index]);
      });
      
      // Progress indicator
      const progress = Math.min(i + batchSize, strings.length);
      process.stdout.write(`   Progress: ${progress}/${strings.length} strings translated\r`);
      
      // Small delay to avoid rate limits
      if (i + batchSize < strings.length) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    } catch (error: any) {
      console.error(`\n   Error in batch ${i / batchSize + 1}:`, error.message);
      // Fallback: translate individually
      for (let j = 0; j < batch.length; j++) {
        const translated = await translateText(batch[j], targetLang);
        translations.set(batchPaths[j], translated);
      }
    }
  }
  
  console.log(`\n   ✅ All strings translated`);
  
  // Apply translations back to object structure
  return applyTranslations(obj, translations);
}

async function translateLocaleFile(targetLang: LanguageCode) {
  const localesDir = join(process.cwd(), 'client', 'src', 'locales');
  const sourceFile = join(localesDir, 'en.json');
  const targetFile = join(localesDir, `${targetLang}.json`);

  console.log(`\n📝 Translating to ${LANGUAGES[targetLang].name} (${targetLang})...`);

  try {
    // Read English source file
    const sourceContent = readFileSync(sourceFile, 'utf-8');
    const sourceJson = JSON.parse(sourceContent);

    console.log(`   Reading ${sourceFile}...`);

    // Translate the entire object
    console.log(`   Found ${Object.keys(sourceJson).length} top-level keys`);
    const translated = await translateObject(sourceJson, targetLang);

    // Write translated file with proper formatting
    const translatedJson = JSON.stringify(translated, null, 2);
    writeFileSync(targetFile, translatedJson, 'utf-8');

    console.log(`   ✅ Successfully translated and saved to ${targetFile}`);
  } catch (error) {
    console.error(`   ❌ Error translating to ${targetLang}:`, error);
    throw error;
  }
}

async function main() {
  console.log('🌍 Starting locale translation with Google Cloud Translate API...');
  console.log('📋 Make sure you have:');
  console.log('   1. Installed: npm install @google-cloud/translate');
  console.log('   2. Set up authentication (see error message if needed)');
  console.log('   3. Enabled Cloud Translation API in Google Cloud Console\n');

  // Initialize client early to catch errors
  try {
    await initializeTranslateClient();
  } catch (error) {
    process.exit(1);
  }

  const languages = Object.keys(LANGUAGES) as LanguageCode[];

  for (const lang of languages) {
    try {
      await translateLocaleFile(lang);
    } catch (error) {
      console.error(`Failed to translate ${lang}:`, error);
      process.exit(1);
    }
  }

  console.log('\n✅ All translations completed!');
  console.log('\n📋 Next steps:');
  console.log('   1. Review the translated files for accuracy');
  console.log('   2. Manually adjust any translations that need refinement');
  console.log('   3. Test the application with different language settings');
}

main().catch(console.error);
