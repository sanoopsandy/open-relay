import type { Skill } from './SkillBase';
import type { SkillMeta } from '../ipc/types';

class SkillRegistry {
  private skills = new Map<string, Skill>();

  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
  }

  get(id: string): Skill {
    const skill = this.skills.get(id);
    if (!skill) throw new Error(`Skill "${id}" not registered`);
    return skill;
  }

  list(): SkillMeta[] {
    return Array.from(this.skills.values()).map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
    }));
  }
}

export const skillRegistry = new SkillRegistry();
