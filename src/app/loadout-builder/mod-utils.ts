import { UpgradeSpendTier } from '@destinyitemmanager/dim-api-types';
import { D2ManifestDefinitions } from 'app/destiny2/d2-definitions';
import { armor2PlugCategoryHashesByName } from 'app/search/d2-known-values';
import { combatCompatiblePlugCategoryHashes } from 'app/search/specialty-modslots';
import { getModTypeTagByPlugCategoryHash, getSpecialtySocketMetadatas } from 'app/utils/item-utils';
import { DestinyEnergyType } from 'bungie-api-ts/destiny2';
import raidModPlugCategoryHashes from 'data/d2/raid-mod-plug-category-hashes.json';
import _ from 'lodash';
import { DimItem, PluggableInventoryItemDefinition } from '../inventory/item-types';
import { bucketsToCategories } from './types';
import {
  canSwapEnergyFromUpgradeSpendTier,
  generatePermutationsOfFive,
  upgradeSpendTierToMaxEnergy,
} from './utils';

/**
 * Checks that:
 *   1. The armour piece is Armour 2.0
 *   2. The mod matches the Armour energy OR the mod has the any Energy type
 */
export const doEnergiesMatch = (
  defs: D2ManifestDefinitions,
  mod: PluggableInventoryItemDefinition,
  item: DimItem,
  upgradeSpendTier: UpgradeSpendTier
) =>
  item.energy &&
  (!mod.plug.energyCost ||
    mod.plug.energyCost.energyType === DestinyEnergyType.Any ||
    mod.plug.energyCost.energyType === item.energy.energyType ||
    canSwapEnergyFromUpgradeSpendTier(defs, upgradeSpendTier, item));

/**
 * Checks to see if some mod in a collection of LockedMod or LockedMod,
 * has an elemental (non-Any) energy requirement
 */
export function someModHasEnergyRequirement(mods: PluggableInventoryItemDefinition[]) {
  return mods.some(
    (mod) => !mod.plug.energyCost || mod.plug.energyCost.energyType !== DestinyEnergyType.Any
  );
}

function stringifyMods(permutation: (PluggableInventoryItemDefinition | null)[]) {
  let permutationString = '';
  for (const modOrNull of permutation) {
    if (modOrNull) {
      const energy = modOrNull.plug.energyCost;
      permutationString += `(${energy?.energyType},${energy?.energyCost},${modOrNull.plug.plugCategoryHash})`;
    }
    permutationString += ',';
  }
  return permutationString;
}

export function getModAssignments(
  items: DimItem[],
  mods: PluggableInventoryItemDefinition[],
  defs: D2ManifestDefinitions,
  upgradeSpendTier: UpgradeSpendTier
) {
  const assignments = new Map<string, PluggableInventoryItemDefinition[]>();

  for (const item of items) {
    assignments.set(item.id, []);
  }

  const itemSocketMetadata = _.mapValues(
    _.keyBy(items, (item) => item.id),
    (item) => getSpecialtySocketMetadatas(item)
  );

  const generalMods: PluggableInventoryItemDefinition[] = [];
  const combatMods: PluggableInventoryItemDefinition[] = [];
  const raidMods: PluggableInventoryItemDefinition[] = [];

  for (const mod of mods) {
    if (mod.plug.plugCategoryHash === armor2PlugCategoryHashesByName.general) {
      generalMods.push(mod);
    } else if (combatCompatiblePlugCategoryHashes.includes(mod.plug.plugCategoryHash)) {
      combatMods.push(mod);
    } else if (raidModPlugCategoryHashes.includes(mod.plug.plugCategoryHash)) {
      raidMods.push(mod);
    } else {
      const itemForMod = items.find(
        (item) => mod.plug.plugCategoryHash === bucketsToCategories[item.bucket.hash]
      );
      itemForMod && assignments.get(itemForMod.id)?.push(mod);
    }
  }

  const itemEnergies = _.mapValues(
    _.keyBy(items, (item) => item.id),
    (item) => ({
      used: _.sumBy(assignments.get(item.id), (mod) => mod.plug.energyCost?.energyCost || 0),
      capacity: upgradeSpendTierToMaxEnergy(defs, upgradeSpendTier, item),
      type:
        !item.energy || canSwapEnergyFromUpgradeSpendTier(defs, upgradeSpendTier, item)
          ? DestinyEnergyType.Any
          : item.energy.energyType,
    })
  );

  const generalModPermutations = generatePermutationsOfFive(generalMods, stringifyMods);
  const combatModPermutations = generatePermutationsOfFive(combatMods, stringifyMods);
  const raidModPermutations = generatePermutationsOfFive(raidMods, stringifyMods);

  combatModLoop: for (const combatP of combatModPermutations) {
    combatItemLoop: for (let i = 0; i < items.length; i++) {
      const combatMod = combatP[i];

      // If a mod is null there is nothing being socketed into the item so move on
      if (!combatMod) {
        continue combatItemLoop;
      }

      const item = items[i];
      const itemEnergy = itemEnergies[item.id];
      const modTag = getModTypeTagByPlugCategoryHash(combatMod.plug.plugCategoryHash);
      const combatEnergyCost = combatMod.plug.energyCost?.energyCost || 0;
      const combatEnergyType = combatMod.plug.energyCost?.energyType || DestinyEnergyType.Any;

      const combatEnergyIsValid =
        itemEnergy &&
        itemEnergy.used + combatEnergyCost <= itemEnergy.capacity &&
        (itemEnergy.type === combatEnergyType ||
          combatEnergyType === DestinyEnergyType.Any ||
          itemEnergy.type === DestinyEnergyType.Any);

      // The other mods wont fit in the item set so move on to the next set of mods
      if (
        !(
          combatEnergyIsValid &&
          modTag &&
          itemSocketMetadata[item.id]?.some((metadata) =>
            metadata.compatibleModTags.includes(modTag)
          )
        )
      ) {
        continue combatModLoop;
      }
    }

    generalModLoop: for (const generalP of generalModPermutations) {
      generalItemLoop: for (let i = 0; i < items.length; i++) {
        const generalMod = generalP[i];

        // If a mod is null there is nothing being socketed into the item so move on
        if (!generalMod) {
          continue generalItemLoop;
        }

        const item = items[i];
        const itemEnergy = itemEnergies[item.id];
        const generalEnergyCost = generalMod.plug.energyCost?.energyCost || 0;
        const generalEnergyType = generalMod.plug.energyCost?.energyType || DestinyEnergyType.Any;
        const combatEnergyCost = combatP?.[i]?.plug.energyCost?.energyCost || 0;
        const combatEnergyType = combatP?.[i]?.plug.energyCost?.energyType || DestinyEnergyType.Any;

        const generalEnergyIsValid =
          itemEnergy &&
          itemEnergy.used + generalEnergyCost + combatEnergyCost <= itemEnergy.capacity &&
          (itemEnergy.type === generalEnergyType ||
            generalEnergyType === DestinyEnergyType.Any ||
            itemEnergy.type === DestinyEnergyType.Any) &&
          (generalEnergyType === combatEnergyType ||
            generalEnergyType === DestinyEnergyType.Any ||
            combatEnergyType === DestinyEnergyType.Any);

        // The general mods wont fit in the item set so move on to the next set of mods
        if (!generalEnergyIsValid) {
          continue generalModLoop;
        }
      }

      raidModLoop: for (const raidP of raidModPermutations) {
        raidItemLoop: for (let i = 0; i < items.length; i++) {
          const raidMod = raidP[i];

          // If a mod is null there is nothing being socketed into the item so move on
          if (!raidMod) {
            continue raidItemLoop;
          }

          const item = items[i];
          const itemEnergy = itemEnergies[item.id];
          const modTag = getModTypeTagByPlugCategoryHash(raidMod.plug.plugCategoryHash);
          const raidEnergyCost = raidMod.plug.energyCost?.energyCost || 0;
          const raidEnergyType = raidMod.plug.energyCost?.energyType || DestinyEnergyType.Any;
          const generalEnergyCost = generalP[i]?.plug.energyCost?.energyCost || 0;
          const generalEnergyType =
            generalP[i]?.plug.energyCost?.energyType || DestinyEnergyType.Any;
          const combatEnergyCost = combatP[i]?.plug.energyCost?.energyCost || 0;
          const combatEnergyType = combatP[i]?.plug.energyCost?.energyType || DestinyEnergyType.Any;

          const raidEnergyIsValid =
            itemEnergy &&
            itemEnergy.used + generalEnergyCost + combatEnergyCost + raidEnergyCost <=
              itemEnergy.capacity &&
            (itemEnergy.type === raidEnergyType ||
              raidEnergyType === DestinyEnergyType.Any ||
              itemEnergy.type === DestinyEnergyType.Any) &&
            (raidEnergyType === generalEnergyType ||
              raidEnergyType === DestinyEnergyType.Any ||
              generalEnergyType === DestinyEnergyType.Any) &&
            (raidEnergyType === combatEnergyType ||
              raidEnergyType === DestinyEnergyType.Any ||
              combatEnergyType === DestinyEnergyType.Any);

          // The raid mods wont fit in the item set so move on to the next set of mods
          if (
            !(
              raidEnergyIsValid &&
              modTag &&
              itemSocketMetadata[item.id]?.some((metadata) =>
                metadata.compatibleModTags.includes(modTag)
              )
            )
          ) {
            continue raidModLoop;
          }
        }

        // calculate best mod assignment here
      }
    }
  }

  return assignments;
}
