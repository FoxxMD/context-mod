import Action, {ActionConfig, ActionJson, ActionOptions} from './index';
import {Comment, RedditUser, Submission} from 'snoowrap';
import {RuleResult} from '../Rule';
import {ActionProcessResult} from '../Common/interfaces';

export class UserFlairAction extends Action {
  text?: string;
  css?: string;
  flair_template_id?: string;

  constructor(options: UserFlairActionOptions) {
    super(options);

    this.text = options.text === null || options.text === '' ? undefined : options.text;
    this.css = options.css === null || options.text === '' ? undefined : options.text;
    this.flair_template_id = options.flair_template_id === null || options.flair_template_id === '' ? undefined : options.flair_template_id;
  }

  getKind() {
    return 'User Flair';
  }

  async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
    const dryRun = runtimeDryrun || this.dryRun;
    let flairParts = [];

    if (this.flair_template_id !== undefined) {
      flairParts.push(`Flair template ID: ${this.flair_template_id}`)
      if(this.text !== undefined || this.css !== undefined) {
        this.logger.warn('Text/CSS properties will be ignored since a flair template is specified');
      }
    } else {
      if (this.text !== undefined) {
        flairParts.push(`Text: ${this.text}`);
      }
      if (this.css !== undefined) {
        flairParts.push(`CSS: ${this.css}`);
      }
    }

    const flairSummary = flairParts.length === 0 ? 'Unflair user' : flairParts.join(' | ');
    this.logger.verbose(flairSummary);

    if (!this.dryRun) {
      if (this.flair_template_id !== undefined) {
        try {
          // @ts-ignore
          await this.client.assignUserFlairByTemplateId({
            subredditName: item.subreddit.display_name,
            flairTemplateId: this.flair_template_id,
            username: item.author.name,
          });
        } catch (err: any) {
          this.logger.error('Either the flair template ID is incorrect or you do not have permission to access it.');
          throw err;
        }
      } else if (this.text === undefined && this.css === undefined) {
        // @ts-ignore
        await item.subreddit.deleteUserFlair(item.author.name);
      } else {
        // @ts-ignore
        await item.author.assignFlair({
          subredditName: item.subreddit.display_name,
          cssClass: this.css,
          text: this.text,
        });
      }
    }

    return {
      dryRun,
      success: true,
      result: flairSummary,
    }
  }
}

/**
 * Flair the Author of an Activity
 *
 * Leave all properties blank or null to remove a User's existing flair
 * */
export interface UserFlairActionConfig extends ActionConfig {
  /**
   * The text of the flair to apply
   * */
  text?: string,
  /**
   * The text of the css class of the flair to apply
   * */
  css?: string,
  /**
   * Flair template to pick.
   *
   * **Note:** If this template is used text/css are ignored
   * */
  flair_template_id?: string;
}

export interface UserFlairActionOptions extends UserFlairActionConfig, ActionOptions {

}

/**
 * Flair the Submission
 * */
export interface UserFlairActionJson extends UserFlairActionConfig, ActionJson {
  kind: 'userflair'
}
