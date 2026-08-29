// The bounded condition-expression language of SCHEMA section 3.1, in its
// entirety: ==, !=, in, &&, ||, !, parentheses, sibling field keys, and
// literals. No arithmetic, no string functions, no regex, ever. Because the
// grammar is this small, expressions are statically analyzable: the editor
// evaluates visibility with zero code execution, and the schema validator
// can reject unknown field keys at install time.

export type ExpressionValue = string | number | boolean;

export type FieldValues = Readonly<Record<string, ExpressionValue | undefined>>;

export type OperandNode
    = | { kind: 'field'; key: string }
        | { kind: 'literal'; value: ExpressionValue }
        | { kind: 'group'; expression: ExpressionNode };

export type ExpressionNode
    = | { kind: 'or'; left: ExpressionNode; right: ExpressionNode }
        | { kind: 'and'; left: ExpressionNode; right: ExpressionNode }
        | { kind: 'not'; operand: ExpressionNode }
        | { kind: 'comparison'; operator: '==' | '!='; left: OperandNode; right: OperandNode }
        | { kind: 'membership'; operand: OperandNode; list: ExpressionValue[] }
        | { kind: 'operand'; operand: OperandNode };

export class ExpressionSyntaxError extends Error
{
    readonly position: number;

    constructor ( message: string, position: number )
    {
        super( message );
        this.name = 'ExpressionSyntaxError';
        this.position = position;
    }
}

type Token
    = | { kind: 'identifier'; text: string; position: number }
        | { kind: 'string'; value: string; position: number }
        | { kind: 'number'; value: number; position: number }
        | { kind: 'boolean'; value: boolean; position: number }
        | { kind: 'punctuation'; text: string; position: number }
        | { kind: 'end'; position: number };

const twoCharacterOperators = [ '==', '!=', '&&', '||' ];
const singleCharacterPunctuation = [ '(', ')', '[', ']', ',', '!' ];

// Field keys share the identifier shape of the schema's field map keys.
// Hyphens are excluded on purpose: the grammar has no arithmetic, but a
// key charset without '-' keeps tokens unambiguous forever.
const identifierStart = /[A-Za-z_]/;
const identifierRest = /[A-Za-z0-9_]/;

function tokenize ( source: string ): Token[]
{
    const tokens: Token[] = [];
    let index = 0;

    while ( index < source.length )
    {
        const character = source[ index ] as string;

        if ( character === ' ' || character === '\t' )
        {
            index += 1;
            continue;
        }

        const pair = source.slice( index, index + 2 );

        if ( twoCharacterOperators.includes( pair ) )
        {
            tokens.push( { kind: 'punctuation', text: pair, position: index } );
            index += 2;
            continue;
        }

        if ( singleCharacterPunctuation.includes( character ) )
        {
            tokens.push( { kind: 'punctuation', text: character, position: index } );
            index += 1;
            continue;
        }

        if ( character === '"' || character === '\'' )
        {
            const closingIndex = source.indexOf( character, index + 1 );

            if ( closingIndex === -1 )
            {
                throw new ExpressionSyntaxError(
                    `Unclosed string starting at position ${index}. Add a closing ${character} quote.`,
                    index,
                );
            }

            tokens.push( { kind: 'string', value: source.slice( index + 1, closingIndex ), position: index } );
            index = closingIndex + 1;
            continue;
        }

        if ( /[0-9]/.test( character ) || ( character === '-' && /[0-9]/.test( source[ index + 1 ] ?? '' ) ) )
        {
            const numberMatch = /^-?[0-9]+(\.[0-9]+)?/.exec( source.slice( index ) ) as RegExpExecArray;
            tokens.push( { kind: 'number', value: Number( numberMatch[ 0 ] ), position: index } );
            index += numberMatch[ 0 ].length;
            continue;
        }

        if ( identifierStart.test( character ) )
        {
            let end = index + 1;

            while ( end < source.length && identifierRest.test( source[ end ] as string ) ) { end += 1; }

            const text = source.slice( index, end );

            if ( text === 'true' || text === 'false' )
            {
                tokens.push( { kind: 'boolean', value: text === 'true', position: index } );
            }
            else
            {
                tokens.push( { kind: 'identifier', text, position: index } );
            }

            index = end;
            continue;
        }

        throw new ExpressionSyntaxError(
            `Unexpected character "${character}" at position ${index}. `
            + 'The condition language allows field keys, quoted strings, numbers, true, false, ==, !=, in, &&, ||, !, parentheses, and [lists].',
            index,
        );
    }

    tokens.push( { kind: 'end', position: source.length } );
    return tokens;
}

class Parser
{
    private readonly tokens: Token[];
    private index = 0;

    constructor ( tokens: Token[] )
    {
        this.tokens = tokens;
    }

    parseExpression (): ExpressionNode
    {
        const expression = this.parseOr();
        const trailing = this.peek();

        if ( trailing.kind !== 'end' )
        {
            throw new ExpressionSyntaxError(
                `Unexpected ${describeToken( trailing )} at position ${trailing.position}. The expression was already complete.`,
                trailing.position,
            );
        }

        return expression;
    }

    private parseOr (): ExpressionNode
    {
        let left = this.parseAnd();

        while ( this.consumePunctuation( '||' ) )
        {
            left = { kind: 'or', left, right: this.parseAnd() };
        }

        return left;
    }

    private parseAnd (): ExpressionNode
    {
        let left = this.parseNot();

        while ( this.consumePunctuation( '&&' ) )
        {
            left = { kind: 'and', left, right: this.parseNot() };
        }

        return left;
    }

    private parseNot (): ExpressionNode
    {
        if ( this.consumePunctuation( '!' ) )
        {
            return { kind: 'not', operand: this.parseNot() };
        }

        return this.parseComparison();
    }

    private parseComparison (): ExpressionNode
    {
        const left = this.parseOperand();

        if ( this.consumePunctuation( '==' ) )
        {
            return { kind: 'comparison', operator: '==', left, right: this.parseOperand() };
        }

        if ( this.consumePunctuation( '!=' ) )
        {
            return { kind: 'comparison', operator: '!=', left, right: this.parseOperand() };
        }

        if ( this.consumeKeyword( 'in' ) )
        {
            return { kind: 'membership', operand: left, list: this.parseLiteralList() };
        }

        return { kind: 'operand', operand: left };
    }

    private parseOperand (): OperandNode
    {
        const token = this.peek();

        if ( token.kind === 'identifier' )
        {
            this.index += 1;
            return { kind: 'field', key: token.text };
        }

        if ( token.kind === 'string' || token.kind === 'number' || token.kind === 'boolean' )
        {
            this.index += 1;
            return { kind: 'literal', value: token.value };
        }

        if ( token.kind === 'punctuation' && token.text === '(' )
        {
            this.index += 1;
            const expression = this.parseOr();
            this.expectPunctuation( ')' );
            return { kind: 'group', expression };
        }

        throw new ExpressionSyntaxError(
            `Expected a field key, a literal, or a parenthesized expression at position ${token.position}, but found ${describeToken( token )}.`,
            token.position,
        );
    }

    private parseLiteralList (): ExpressionValue[]
    {
        this.expectPunctuation( '[' );
        const values: ExpressionValue[] = [];

        while ( true )
        {
            const token = this.peek();

            if ( token.kind === 'string' || token.kind === 'number' || token.kind === 'boolean' )
            {
                this.index += 1;
                values.push( token.value );
            }
            else
            {
                throw new ExpressionSyntaxError(
                    `Lists may contain only literals. Found ${describeToken( token )} at position ${token.position}.`,
                    token.position,
                );
            }

            if ( this.consumePunctuation( ',' ) ) { continue; }

            this.expectPunctuation( ']' );
            return values;
        }
    }

    private peek (): Token
    {
        return this.tokens[ this.index ] as Token;
    }

    private consumePunctuation ( text: string ): boolean
    {
        const token = this.peek();

        if ( token.kind === 'punctuation' && token.text === text )
        {
            this.index += 1;
            return true;
        }

        return false;
    }

    private consumeKeyword ( text: string ): boolean
    {
        const token = this.peek();

        if ( token.kind === 'identifier' && token.text === text )
        {
            this.index += 1;
            return true;
        }

        return false;
    }

    private expectPunctuation ( text: string ): void
    {
        const token = this.peek();

        if ( token.kind === 'punctuation' && token.text === text )
        {
            this.index += 1;
            return;
        }

        throw new ExpressionSyntaxError(
            `Expected "${text}" at position ${token.position}, but found ${describeToken( token )}.`,
            token.position,
        );
    }
}

function describeToken ( token: Token ): string
{
    switch ( token.kind )
    {
        case 'identifier': return `the field key "${token.text}"`;
        case 'string': return `the string "${token.value}"`;
        case 'number': return `the number ${token.value}`;
        case 'boolean': return `the literal ${token.value}`;
        case 'punctuation': return `"${token.text}"`;
        case 'end': return 'the end of the expression';
    }
}

export function parseExpression ( source: string ): ExpressionNode
{
    return new Parser( tokenize( source ) ).parseExpression();
}

// Absent-field semantics come from SCHEMA section 3.2: a hidden field is
// absent from the payload, and in expressions an absent field is falsy,
// "==" anything is false, "!=" anything is true, and "in" anything is false.
const absent = Symbol( 'absent' );

type OperandResult = ExpressionValue | typeof absent;

function evaluateOperand ( operand: OperandNode, fields: FieldValues ): OperandResult
{
    switch ( operand.kind )
    {
        case 'field': return fields[ operand.key ] ?? absent;
        case 'literal': return operand.value;
        case 'group': return evaluateExpression( operand.expression, fields );
    }
}

function isTruthy ( result: OperandResult ): boolean
{
    if ( result === absent ) { return false; }
    if ( typeof result === 'boolean' ) { return result; }
    if ( typeof result === 'number' ) { return result !== 0 && !Number.isNaN( result ); }

    return result.length > 0;
}

export function evaluateExpression ( expression: ExpressionNode, fields: FieldValues ): boolean
{
    switch ( expression.kind )
    {
        case 'or':
            return evaluateExpression( expression.left, fields ) || evaluateExpression( expression.right, fields );

        case 'and':
            return evaluateExpression( expression.left, fields ) && evaluateExpression( expression.right, fields );

        case 'not':
            return !evaluateExpression( expression.operand, fields );

        case 'comparison':
        {
            const left = evaluateOperand( expression.left, fields );
            const right = evaluateOperand( expression.right, fields );
            const bothPresent = left !== absent && right !== absent;
            const equal = bothPresent && left === right;

            return expression.operator === '==' ? equal : !equal;
        }

        case 'membership':
        {
            const value = evaluateOperand( expression.operand, fields );

            if ( value === absent ) { return false; }

            return expression.list.includes( value );
        }

        case 'operand':
            return isTruthy( evaluateOperand( expression.operand, fields ) );
    }
}

// The static half of the bargain: every field key an expression mentions,
// so the schema validator can reject unknown keys and circular showWhen
// chains at install time without executing anything.
export function collectReferencedFieldKeys ( expression: ExpressionNode ): Set<string>
{
    const keys = new Set<string>();

    const visitOperand = ( operand: OperandNode ): void =>
    {
        if ( operand.kind === 'field' ) { keys.add( operand.key ); }
        if ( operand.kind === 'group' ) { visitExpression( operand.expression ); }
    };

    const visitExpression = ( node: ExpressionNode ): void =>
    {
        switch ( node.kind )
        {
            case 'or':
            case 'and':
                visitExpression( node.left );
                visitExpression( node.right );
                return;

            case 'not':
                visitExpression( node.operand );
                return;

            case 'comparison':
                visitOperand( node.left );
                visitOperand( node.right );
                return;

            case 'membership':
            case 'operand':
                visitOperand( node.operand );
                return;
        }
    };

    visitExpression( expression );
    return keys;
}
