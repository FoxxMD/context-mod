import Action, {ActionConfig, ActionJson, ActionOptions} from './index';
import {Comment, RedditUser, Submission} from 'snoowrap';
import {RuleResult} from '../Rule';
import {ActionProcessResult} from '../Common/interfaces';

export class UserFlairAction extends Action {
  text: string;
  css: string;
  flair_template_id: string;

  constructor(options: UserFlairActionOptions) {
    super(options);

    if (options.text === undefined && options.css === undefined && options.flair_template_id === undefined) {
      throw new Error('Must define either text, css or flair_template_id on UserFlairAction');
    }

    this.text = options.text || '';
    this.css = options.css || '';
    this.flair_template_id = options.flair_template_id || '';
  }

  getKind() {
    return 'User Flair';
  }

  async process(item: Comment | Submission, ruleResults: RuleResult[], runtimeDryrun?: boolean): Promise<ActionProcessResult> {
    const dryRun = runtimeDryrun || this.dryRun;
    let flairParts = [];

    if (this.flair_template_id !== '') {
      flairParts.push(`Flair template ID: ${this.flair_template_id}`)
    } else {
      if (this.text !== '') {
        flairParts.push(`Text: ${this.text}`);
      }
      if (this.css !== '') {
        flairParts.push(`CSS: ${this.css}`);
      }
    }

    const flairSummary = flairParts.length === 0 ? 'No user flair (unflaired)' : flairParts.join(' | ');
    this.logger.verbose(flairSummary);
    if (item && item?.author) {
      if (!this.dryRun) {
        if (this.flair_template_id !== '') {
          // @ts-ignore
          await this.client.assignUserFlairByTemplateId({
            subredditName: item.subreddit.display_name,
            flairTemplateId: this.flair_template_id,
            username: item.author.name,
          })
            .then((e: any) => {
              this.logger.verbose(JSON.stringify(e));
            })
            .catch((e: any) => {
              this.logger.verbose(JSON.stringify(e));
            })
        }
      } else {
        // @ts-ignore
        await (item.author as RedditUser).assignFlair({
          subredditName: item.subreddit.display_name,
          cssClass: this.css,
          text: this.text,
        })
      }
    } else {
      this.logger.warn('Cannot flair Comment');
      return {
        dryRun,
        success: false,
        result: 'Cannot flair Comment',
      }
    }
    return {
      dryRun,
      success: true,
      result: flairSummary,
    }
  }
}

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
   * Flair template it to pick
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