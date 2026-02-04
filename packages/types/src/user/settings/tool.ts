import type { UserInterventionConfig } from '../../tool';

export interface UserToolConfig {
  humanIntervention?: UserInterventionConfig;
  /**
   * List of builtin tool identifiers that have been installed by the user.
   * By default, no builtin tools are installed. Users need to explicitly
   * install the tools they want to use.
   */
  installedBuiltinTools?: string[];
}
