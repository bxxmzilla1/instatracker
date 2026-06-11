import { isSupabaseConfigured } from './supabase';
import * as local from './dbLocal';
import * as remote from './dbSupabase';

const impl = isSupabaseConfigured ? remote : local;

export const {
  getAccounts,
  addAccount,
  updateAccount,
  removeAccount,
  saveFollowerSnapshot,
  getFollowerHistory,
  getAllFollowerSnapshots,
  saveReelSnapshots,
  getAllReelSnapshots,
  getReelHistories,
  getEmployees,
  addEmployee,
  deleteEmployee,
  getLicenses,
  addLicense,
  deleteLicense,
} = impl;
